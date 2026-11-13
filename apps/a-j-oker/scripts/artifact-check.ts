import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { artifacts } from "../../../packages/base-chat-protocol/test/fixtures";
import {
  createRunReader,
  clientEventSchema,
} from "@cfp/base-chat-protocol";
import {
  AJ_CATALOG_ID,
  AJ_PRESENTATION_CATALOG_HEADER,
  ajClientEvent,
  legacyAjArtifactsSchema,
  toAjA2ui,
  validateAjA2uiMessages,
} from "@cfp/a-j-oker-contracts";
import { ScriptedModel } from "./scripted-model";
import { seedSyntheticAge } from "./synthetic-age";
import type { Moderator } from "../src/domain/moderation";
import { imageReview, syntheticTextReview } from "./synthetic-text-review";

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
const oldIdentifier = z
  .string()
  .regex(/^(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/);
const oldFormValuesSchema = z.record(
  oldIdentifier,
  z.union([z.string().max(1200), z.number().finite()]),
);
const oldInputSchema = z
  .object({
    text: z.string().trim().max(4000).default(""),
    mediaIds: z.array(z.number().int().positive()).max(3).default([]),
    formResponse: z
      .object({
        turnId: z.number().int().positive(),
        artifactId: oldIdentifier,
        values: oldFormValuesSchema,
      })
      .strict()
      .optional(),
  })
  .refine(
    (value) =>
      value.text.length > 0 ||
      value.mediaIds.length > 0 ||
      !!value.formResponse,
  );
const oldTurnResultSchema = z.object({
  id: z.number().int().positive(),
  input: oldInputSchema,
  status: z.enum(["running", "completed", "failed"]),
  visibility: z.literal("quarantined").optional(),
  imageGeneration: z
    .object({
      status: z.enum(["submitting", "pending", "stored", "failed", "blocked"]),
      canResume: z.boolean(),
    })
    .nullish(),
  mode: z.enum(["platform", "byok", "external"]),
  greeting: z.string().nullish(),
  error: z.string().nullish(),
  association: z.string().nullish(),
  approach: z.string().nullish(),
  artifacts: legacyAjArtifactsSchema.nullish(),
  model: z.string().nullish(),
  createdAt: z.string(),
});
const oldHistorySchema = z.array(oldTurnResultSchema);
const oldSubmissionResultSchema = z.object({
  turn: oldTurnResultSchema.nullable(),
});
const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
// 本脚本验证作品协议与保存链路；真实审核失败关闭另由 operations/moderation 检查覆盖。
const syntheticReviews = {
  moderate: (async (request: Parameters<Moderator>[0]) =>
    request.purpose === "image_generation" ? imageReview(true) : syntheticTextReview(request)) satisfies Moderator,
  imageReviewer: async () => ({ decision: "allow" as const, category: "synthetic-artifacts", version: "mock-pixels-test-only" }),
};
try {
  const owner = { id: randomUUID(), auth: "cookie" as const };
  const repo = new Repository(payload, owner);
  // Text-only rest cards exercise structured text artifacts; real image delivery is covered by image-generation-check.
  const textArtifacts = artifacts.filter((artifact) => artifact.kind !== "image");
  const model = new ScriptedModel({
    greeting: "且把眼前的小事理清楚。",
    association: "回应作品链路验收",
    approach: "cbt",
    artifacts: textArtifacts,
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
    input: { text: "制作休息提醒卡，只生成文本，并提供情绪练习" },
  };
  const saved = await service.generateGreeting(input);
  assert.deepEqual(saved.artifacts, textArtifacts);
  assert.deepEqual((await service.history(session.id))[0].artifacts, textArtifacts);
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
  const legacyMixedArtifacts = textArtifacts.map((artifact) =>
    artifact.kind === "form"
      ? {
          ...artifact,
          fields: [
            ...artifact.fields.map((field) =>
              field.id === "emotion"
                ? { ...field, min: 1, max: 20 }
                : field,
            ),
            {
              id: "bounded_score",
              label: "有下限的评分",
              type: "number" as const,
              required: true,
              min: 1,
              max: 5,
            },
            {
              id: "zero_score",
              label: "可为零的评分",
              type: "number" as const,
              required: true,
              min: 0,
              max: 5,
            },
          ],
        }
      : artifact,
  );
  await repo.update("greetings", saved.id, {
    artifacts: legacyMixedArtifacts,
  });
  const replayedForm = (await service.history(session.id))[0].artifacts?.find(
    (artifact) => artifact.kind === "form",
  );
  const replayedBoundedField =
    replayedForm?.kind === "form"
      ? replayedForm.fields.find((field) => field.id === "bounded_score")
      : undefined;
  assert.equal(
    replayedBoundedField?.type === "number"
      ? replayedBoundedField.min
      : undefined,
    1,
  );
  const messages = validateAjA2uiMessages(
    toAjA2ui(saved.id, legacyMixedArtifacts),
  );
  const formId = `turn_${saved.id}_thought_record`;
  assert.ok(
    messages.some(
      (message) =>
        "createSurface" in message &&
        message.createSurface.surfaceId === formId,
    ),
  );
  // Same public event contract as the real CopilotKit/native round trips in the client tests.
  const formRunId = randomUUID();
  const action = clientEventSchema.parse(
    ajClientEvent({
      turnId: saved.id,
      artifactId: "thought_record",
      requestId: formRunId,
      values: {
        situation: "会议中说错一个数字，已经更正",
        thought: "怕被否定",
        intensity: 0,
        bounded_score: 1,
        zero_score: 0,
      },
    }),
  );
  const body = {
    protocolVersion: "1.0",
    threadId: String(session.id),
    runId: formRunId,
    tools: [],
    context: [],
    messages: [{ id: "form", role: "user", content: "客户端不能伪造字段说明" }],
    forwardedProps: {
      mode: "platform",
      clientEvent: action,
      a2uiClientCapabilities: { supportedCatalogIds: [AJ_CATALOG_ID] },
    },
  };
  const args = readAgentInput(body);
  const response = agentStream(service, args);
  const wire = await response.text();
  const reader = createRunReader(body.runId, undefined, {
    catalogIds: [AJ_CATALOG_ID],
  });
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
        requestId: randomUUID(),
        input: {
          formResponse: {
            turnId: saved.id,
            artifactId: "thought_record",
            values: {
              situation: "x",
              bounded_score: 0,
              zero_score: 0,
            },
          },
        },
      }),
    /不能小于 1/,
  );
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
  const choiceForm = {
    kind: "form" as const,
    id: "choices",
    title: "结构化追踪",
    description: "选项和补充说明都以原标签进入后端。",
    submitLabel: "提交",
    fields: [
      {
        id: "mood",
        label: "主要感受",
        type: "select" as const,
        required: true,
        options: [
          { id: "tired", label: "有点累" },
          { id: "calm", label: "还算平静" },
        ],
        allowOther: true,
      },
      {
        id: "support",
        label: "可用支持",
        type: "multiSelect" as const,
        required: true,
        options: [
          { id: "friend", label: "朋友" },
          { id: "walk", label: "散步" },
        ],
        allowOther: true,
        minChoices: 1,
        maxChoices: 3,
      },
    ],
  };
  const choiceModel = new ScriptedModel({
    greeting: "这些选择已经保留原样。",
    association: "结构化答案回归",
    approach: "cbt",
    artifacts: [choiceForm],
  });
  const choiceService = new GreetingService(
    repo,
    (request) => runGreeting(request, choiceModel),
    undefined,
    undefined,
    syntheticReviews,
  );
  const choiceSource = await choiceService.generateGreeting({
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "platform",
    input: { text: "生成结构化选择练习" },
  });
  const structuredValues = {
    mood: { optionIds: ["tired"] },
    support: { optionIds: ["friend", "walk"], otherText: "写日记" },
  };
  await assert.rejects(
    () =>
      choiceService.generateGreeting({
        sessionId: session.id,
        requestId: randomUUID(),
        mode: "platform",
        input: {
          text: "提交结构化练习",
          formResponse: {
            turnId: choiceSource.id,
            artifactId: "choices",
            values: {
              ...structuredValues,
              mood: { optionIds: ["forged"], otherText: "伪造" },
            },
          },
        },
      }),
    /无效选项/,
  );
  await assert.rejects(
    () =>
      choiceService.generateGreeting({
        sessionId: session.id,
        requestId: randomUUID(),
        mode: "platform",
        input: {
          text: "提交结构化练习",
          formResponse: {
            turnId: choiceSource.id,
            artifactId: "choices",
            values: { ...structuredValues, mood: { unknown: true } },
          },
        },
      }),
    /未知答案/,
  );
  const structured = await choiceService.generateGreeting({
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "platform",
    input: {
      text: "提交结构化练习",
      formResponse: {
        turnId: choiceSource.id,
        artifactId: "choices",
        values: structuredValues,
      },
    },
  });
  assert.deepEqual(structured.input.formResponse?.values, structuredValues);
  const modelInput = JSON.stringify(
    choiceModel.requests.slice(3).map((request) => request.contents),
  );
  for (const expected of ["有点累", "朋友", "散步", "写日记"])
    assert.ok(modelInput.includes(expected), `后端应保留标签：${expected}`);
  assert.ok(!modelInput.includes("[object Object]"));
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
    input: { text: "制作休息提醒卡（历史外部协议兼容测试）" },
    model: "test-client",
    output: {
      greeting: "外部生成的作品。",
      association: "外部声明",
      artifacts,
    },
  });
  assert.deepEqual(external.artifacts, artifacts);
  const modernRequestId = randomUUID();
  const modernExternal = await service.acceptExternal({
    sessionId: session.id,
    requestId: modernRequestId,
    input: { text: "保存新版展示能力" },
    model: "test-client-v2",
    output: {
      greeting: "新版作品已保存。",
      association: "传输兼容",
      artifacts: [
        {
          kind: "card",
          id: "legacy_safe",
          title: "兼容卡片",
          body: "旧客户仍可读这段正文。",
        },
        {
          kind: "table",
          id: "scalar_table",
          title: "标量表格",
          columns: ["分数", "完成"],
          rows: [[0, false]],
        },
        {
          kind: "code",
          id: "snippet",
          title: "代码片段",
          language: "text",
          code: "hello",
        },
        choiceForm,
      ],
    },
  });
  const badExternalId = randomUUID();
  await assert.rejects(
    () =>
      service.acceptExternal({
        sessionId: session.id,
        requestId: badExternalId,
        input: { text: "制作休息提醒卡，不可引用不存在的图片" },
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
    { greeting: "现在修好了。", association: "格式修复验收", artifacts: textArtifacts },
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
  assert.deepEqual(repaired.artifacts, textArtifacts);
  await seedSyntheticAge(payload, repo.owner);
  await seedSyntheticAge(payload, stranger.repo.owner);
  const credential = await mintCredential(payload, "cookie", owner.id, repo.owner.wechatKey);
  const historySegments = ["sessions", String(session.id)];
  const readHistory = async (current: boolean) => {
    const response = await GET(
      new Request(
        `http://127.0.0.1:3310/api/hello/${historySegments.join("/")}`,
        {
          headers: {
            Cookie: `${COOKIE}=${credential.token}`,
            ...(current
              ? { [AJ_PRESENTATION_CATALOG_HEADER]: AJ_CATALOG_ID }
              : {}),
          },
        },
      ),
      { params: Promise.resolve({ path: historySegments }) },
    );
    assert.equal(response.status, 200);
    const value = await response.json();
    return current
      ? (value as Array<{
          id: number;
          input: { text: string; formResponse?: unknown };
          artifacts?: unknown;
        }>)
      : oldHistorySchema.parse(value);
  };
  const legacyHistory = await readHistory(false);
  const currentHistory = await readHistory(true);
  const legacyModern = legacyHistory.find((turn) => turn.id === modernExternal.id);
  const currentModern = currentHistory.find((turn) => turn.id === modernExternal.id);
  assert.ok(legacyModern && currentModern);
  assert.deepEqual(
    legacyAjArtifactsSchema.parse(legacyModern.artifacts),
    [modernExternal.artifacts?.[0]],
  );
  assert.equal((currentModern.artifacts as unknown[]).length, 4);
  const legacyStructured = legacyHistory.find((turn) => turn.id === structured.id);
  assert.ok(legacyStructured?.input.text.includes("有点累"));
  assert.equal(legacyStructured?.input.formResponse, undefined);
  const submissionSegments = [
    "sessions",
    String(session.id),
    "requests",
    modernRequestId,
  ];
  const legacySubmission = await GET(
    new Request(
      `http://127.0.0.1:3310/api/hello/${submissionSegments.join("/")}`,
      { headers: { Cookie: `${COOKIE}=${credential.token}` } },
    ),
    { params: Promise.resolve({ path: submissionSegments }) },
  );
  assert.equal(legacySubmission.status, 200);
  const legacySubmissionBody = oldSubmissionResultSchema.parse(
    await legacySubmission.json(),
  );
  assert.ok(legacySubmissionBody.turn);
  assert.deepEqual(
    legacyAjArtifactsSchema.parse(legacySubmissionBody.turn?.artifacts),
    [modernExternal.artifacts?.[0]],
  );
  for (const kind of ["image", "page"]) {
    const segments = [
      `artifact-${kind}`,
      String(external.id),
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
    "✓ 四类文字作品经真实 ADK 工具保存；五类历史外部作品兼容，AG-UI/A2UI 表单往返、内容重建、幂等、历史恢复、跨会话/用户拒绝、外部产物及私有图片/网页读取通过。",
  );
} finally {
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
