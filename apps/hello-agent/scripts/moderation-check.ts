import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModerationRequest } from "../src/domain/moderation";

const dir = await mkdtemp(path.join(tmpdir(), "hello-moderation-check-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "moderation-integration-test-only";
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
process.env.DEEPSEEK_API_KEY = "platform-test-key";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { ContentReviewError } = await import("../src/domain/contracts");
const { runGreeting } = await import("../src/agent/runtime");
const { ScriptedModel } = await import("./scripted-model");
const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
try {
  const repo = new Repository(payload, { id: randomUUID(), auth: "cookie" });
  const reviews: ModerationRequest[] = [];
  let calls = 0;
  const service = new GreetingService(repo, async (args) => {
    calls++;
    await args.save({ greeting: "愿你安好", association: "关照今天" });
  }, undefined, undefined, { moderate: async (review) => {
    reviews.push(review);
    if (review.texts.some((text) => text.includes("拦截样本"))) throw new ContentReviewError(422, "测试审核拒绝");
  } });
  const session = await service.createSession();
  const input = { sessionId: session.id, requestId: randomUUID(), mode: "byok", apiKey: "byok-test-key", input: { text: "今天开心" } };
  const completed = await service.generateGreeting(input);
  assert.deepEqual(reviews.map((review) => review.stage), ["input", "output"]);
  assert.ok(reviews.every((review) => review.apiKey === "byok-test-key"));
  await service.generateGreeting(input);
  assert.equal(reviews.length, 2);
  assert.equal(calls, 1);
  await assert.rejects(() => service.generateGreeting({ ...input, mode: "platform", requestId: randomUUID(), input: { text: "拦截样本" } }), { status: 422 });
  assert.equal(reviews.at(-1)?.apiKey, "platform-test-key");
  assert.equal(calls, 1);
  assert.equal((await service.history(session.id)).length, 1);

  const external = { sessionId: session.id, requestId: randomUUID(), input: { text: "普通输入" }, model: "external", output: {
    greeting: "平安喜乐", association: "今日祝福", artifacts: [{ kind: "card", id: "card1", title: "普通标题", body: "嵌套的拦截样本" }],
  } };
  await assert.rejects(() => service.acceptExternal(external), { status: 422 });
  assert.equal(reviews.at(-1)?.apiKey, "platform-test-key");
  const failed = (await service.history(session.id)).find((row) => row.status === "failed");
  assert.ok(failed);
  assert.ok(!failed.artifacts && !failed.greeting);

  const form = await service.acceptExternal({ ...external, requestId: randomUUID(), output: {
    greeting: "可以填填想法", association: "练习回传", artifacts: [{ kind: "form", id: "form1", title: "练习", description: "记录想法", submitLabel: "提交", fields: [{ id: "answer", type: "text", label: "想法", required: true }] }],
  } });
  await assert.rejects(() => service.generateGreeting({ ...input, requestId: randomUUID(), input: {
    formResponse: { turnId: form.id, artifactId: "form1", values: { answer: "拦截样本" } },
  } }), { status: 422 });
  assert.ok(reviews.at(-1)?.texts[0].includes("想法：拦截样本"));
  assert.equal(calls, 1);
  assert.equal(completed.status, "completed");
  const scriptedModel = new ScriptedModel({ greeting: "待审输出", association: "审核失败测试" });
  let outputReviews = 0;
  const stopped = new GreetingService(repo, (args) => runGreeting(args, scriptedModel), undefined, undefined, { moderate: async (review) => {
    if (review.stage === "output") {
      outputReviews++;
      throw new ContentReviewError(503, "审核服务暂不可用");
    }
  } });
  const stoppedSession = await stopped.createSession();
  await assert.rejects(() => stopped.generateGreeting({ ...input, sessionId: stoppedSession.id, requestId: randomUUID() }), { status: 503, message: "审核服务暂不可用" });
  assert.equal(outputReviews, 1);
  assert.equal(scriptedModel.requests.length, 1);
  const stoppedHistory = await stopped.history(stoppedSession.id);
  assert.equal(stoppedHistory[0].status, "failed");
  assert.ok(!stoppedHistory[0].greeting);
  assert.ok(!JSON.stringify(await repo.all("adk-sessions")).includes("待审输出"), "被拒模型正文不能重复留在执行轨迹中");
  console.log("✓ 平台/BYOK/外部统一审核、嵌套作品、表单回传、幂等和拒绝前不发布（真实 Payload，模拟审核决定）");
  console.log("✓ 真实 ADK 收到审核失败即停止，无额外模型重试，安全错误状态保持且不发布输出");
} finally {
  await payload.destroy();
}
