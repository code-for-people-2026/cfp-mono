import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artifacts } from "../../../packages/hello-agent-protocol/test/fixtures";
import {
  createRunReader,
  A2UI_VERSION,
  clientEventSchema,
  toA2ui,
  validateA2uiMessages,
} from "@cfp/hello-agent-protocol";
import { ScriptedModel } from "./scripted-model";
import { seedSyntheticAge } from "./synthetic-age";

const directory = await mkdtemp(path.join(tmpdir(), "aj-artifact-check-"));
process.env.HELLO_DATABASE_URI = `file:${directory}/test.db`;
process.env.PAYLOAD_SECRET = "artifact-check-only-secret";
process.env.DEEPSEEK_API_KEY = "artifact-check-only-key";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { runGreeting } = await import("../src/agent/runtime");
const { readAgentInput, agentStream } = await import("../src/server/ag-ui");
const { mintCredential, COOKIE } = await import("../src/server/auth");
const { GET } = await import("../src/app/api/hello/[...path]/route");
const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
// 本脚本验证作品协议与保存链路；真实审核失败关闭另由 operations/moderation 检查覆盖。
const syntheticReviews = { moderate: async () => {}, imageReviewer: async () => ({ decision: "allow" as const, category: "synthetic-artifacts", version: "mock-pixels-test-only" }) };
try {
  const owner = { id: randomUUID(), auth: "cookie" as const };
  const repo = new Repository(payload, owner);
  const model = new ScriptedModel({
    greeting: "且把眼前的小事理清楚。",
    association: "回应作品链路验收",
    approach: "cbt",
    artifacts,
  });
  const service = new GreetingService(repo, (request) =>
    runGreeting(request, model),
    undefined, undefined, syntheticReviews,
  );
  const session = await service.createSession("回应作品测试");
  const input = {
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "platform",
    input: { text: "试试这五种作品" },
  };
  const saved = await service.generateGreeting(input);
  assert.deepEqual(saved.artifacts, artifacts);
  assert.deepEqual((await service.history(session.id))[0].artifacts, artifacts);
  assert.equal((await service.generateGreeting(input)).id, saved.id);
  assert.equal(model.requests.length, 3);
  const executionSessions = await repo.list("adk-sessions");
  const specialistSession = executionSessions.find(
    (row) => row.snapshot.id === `${saved.id}:cbt`,
  );
  assert.ok(specialistSession, "心理 subagent 的独立执行会话写入 Payload");
  assert.ok(
    specialistSession.snapshot.events.some(
      (event) => event.author === "cbt_agent",
    ),
  );
  assert.ok(
    !specialistSession.snapshot.events.some(
      (event) => event.author === "greeting_agent",
    ),
  );

  await assert.rejects(
    () =>
      service.complete(saved.id, {
        greeting: String(saved.greeting),
        association: String(saved.association),
        artifacts: [],
      }),
    /不能覆盖/,
  );
  const messages = validateA2uiMessages(toA2ui(saved.id, saved.artifacts));
  const formId = `turn_${saved.id}_thought_record`;
  assert.ok(
    messages.some(
      (message) =>
        "createSurface" in message &&
        message.createSurface.surfaceId === formId,
    ),
  );
  // Same public event contract as the real CopilotKit/native round trips in the client tests.
  const action = clientEventSchema.parse({
    version: A2UI_VERSION,
    action: {
      name: "submit_form",
      surfaceId: formId,
      sourceComponentId: "submit",
      timestamp: new Date().toISOString(),
      context: {
        values: {
          situation: "会议中说错一个数字，已经更正",
          thought: "怕被否定",
          intensity: 0,
        },
      },
    },
  });
  const body = {
    protocolVersion: "1.0",
    threadId: String(session.id),
    runId: randomUUID(),
    tools: [],
    context: [],
    messages: [{ id: "form", role: "user", content: "客户端不能伪造字段说明" }],
    forwardedProps: { mode: "platform", clientEvent: action },
  };
  const args = readAgentInput(body);
  const response = agentStream(service, args);
  const wire = await response.text();
  const reader = createRunReader(body.runId);
  reader.push(wire);
  reader.finish();
  const history = await service.history(session.id);
  assert.equal(history.length, 2);
  assert.match(
    JSON.stringify(model.requests[3].contents),
    /发生了什么.*会议中说错/,
  );
  assert.ok(
    !JSON.stringify(model.requests[3].contents).includes(
      "客户端不能伪造字段说明",
    ),
  );
  assert.equal((await service.generateGreeting(args)).id, history[1].id);
  assert.equal(model.requests.length, 6);
  const otherSession = await service.createSession("另一个会话");
  await assert.rejects(
    () =>
      service.generateGreeting({
        ...args,
        sessionId: otherSession.id,
        requestId: randomUUID(),
      }),
    /不属于当前对话/,
  );
  await assert.rejects(
    () =>
      service.generateGreeting({
        ...args,
        requestId: randomUUID(),
        input: {
          formResponse: {
            turnId: saved.id,
            artifactId: "thought_record",
            values: { situation: "x", intensity: 101 },
          },
        },
      }),
    /100/,
  );
  await assert.rejects(
    () =>
      service.generateGreeting({
        ...args,
        requestId: randomUUID(),
        input: {
          formResponse: {
            turnId: saved.id,
            artifactId: "one_step",
            values: {},
          },
        },
      }),
    /表单不存在/,
  );
  const stranger = new GreetingService(
    new Repository(payload, { id: randomUUID(), auth: "cookie" }),
  );
  const strangerSession = await stranger.createSession("其他访客");
  await assert.rejects(
    () =>
      stranger.generateGreeting({
        ...args,
        requestId: randomUUID(),
        sessionId: strangerSession.id,
      }),
    /无权访问/,
  );
  assert.equal(model.requests.length, 6);
  const external = await service.acceptExternal({
    sessionId: session.id,
    requestId: randomUUID(),
    input: { text: "外部作品" },
    model: "test-client",
    output: {
      greeting: "外部生成的作品。",
      association: "外部声明",
      artifacts,
    },
  });
  assert.deepEqual(external.artifacts, artifacts);
  const badExternalId = randomUUID();
  await assert.rejects(
    () =>
      service.acceptExternal({
        sessionId: session.id,
        requestId: badExternalId,
        input: { text: "不可引用不存在的图片" },
        model: "test-client",
        output: {
          greeting: "图片作品测试。",
          association: "验收",
          artifacts: [
            {
              kind: "image",
              id: "unknown",
              title: "图片",
              alt: "测试",
              source: { type: "media", mediaId: 999999 },
            },
          ],
        },
      }),
    /无权访问/,
  );
  assert.equal(
    (await service.submission(session.id, badExternalId)).turn?.status,
    "failed",
  );
  const repairedModel = new ScriptedModel([
    {
      greeting: "格式需要修正。",
      association: "验收",
      artifacts: [
        {
          kind: "table",
          id: "broken",
          title: "表格",
          columns: ["一列"],
          rows: [["多出", "一列"]],
        },
      ],
    },
    { greeting: "现在修好了。", association: "格式修复验收", artifacts },
  ]);
  const repairedService = new GreetingService(repo, (request) =>
    runGreeting(request, repairedModel),
    undefined, undefined, syntheticReviews,
  );
  const repaired = await repairedService.generateGreeting({
    ...input,
    sessionId: otherSession.id,
    requestId: randomUUID(),
  });
  assert.equal(repairedModel.requests.length, 2);
  assert.equal(repaired.status, "completed");
  assert.equal((await service.history(otherSession.id)).length, 1);
  assert.match(
    JSON.stringify(repairedModel.requests[1].contents),
    /回应尚未保存/,
  );
  assert.deepEqual(repaired.artifacts, artifacts);
  await seedSyntheticAge(payload, repo.owner);
  await seedSyntheticAge(payload, stranger.repo.owner);
  const credential = await mintCredential(payload, "cookie", owner.id, repo.owner.wechatKey);
  for (const kind of ["image", "page"]) {
    const segments = [
      `artifact-${kind}`,
      String(saved.id),
      kind === "image" ? "sun" : "rest",
    ];
    const url = `http://127.0.0.1:3310/api/hello/${segments.join("/")}`;
    const result = await GET(
      new Request(url, {
        headers: { Cookie: `${COOKIE}=${credential.token}` },
      }),
      { params: Promise.resolve({ path: segments }) },
    );
    assert.equal(result.status, 200);
    assert.match(
      result.headers.get("content-type")!,
      kind === "image" ? /image\/png/ : /text\/html/,
    );
    if (kind === "page")
      assert.match(
        result.headers.get("content-security-policy")!,
        /default-src 'none'/,
      );
    const anonymous = await GET(new Request(url), {
      params: Promise.resolve({ path: segments }),
    });
    assert.equal(anonymous.status, 401);
    const otherCredential = await mintCredential(
      payload,
      "cookie",
      stranger.repo.owner.id,
      stranger.repo.owner.wechatKey,
    );
    const denied = await GET(
      new Request(url, {
        headers: { Cookie: `${COOKIE}=${otherCredential.token}` },
      }),
      { params: Promise.resolve({ path: segments }) },
    );
    assert.equal(denied.status, 404);
  }
  console.log(
    "✓ 五类作品经真实 ADK 工具保存；AG-UI/A2UI 表单往返、内容重建、幂等、历史恢复、跨会话/用户拒绝、外部产物及私有图片/网页读取通过。",
  );
} finally {
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
