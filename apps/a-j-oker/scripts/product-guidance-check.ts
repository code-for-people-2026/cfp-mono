import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const dir = await mkdtemp(join(tmpdir(), "hello-semantic-boundary-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`,
  PAYLOAD_SECRET: randomUUID() + randomUUID(),
  HELLO_DEPLOYED: "false",
  HELLO_PRIVACY_DELETION_LEDGER: `${dir}/deletions.ndjson`,
  DEEPSEEK_API_KEY: "synthetic-only",
});
globalThis.fetch = async () => { throw new Error("network prohibited"); };

const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { seedSyntheticAge } = await import("./synthetic-age");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { ContentReviewError } = await import("../src/domain/contracts");
const { ageProfile } = await import("../src/age/service");
const { ordinarySemanticInputs } = await import("./semantic-fixtures");
const { runGreeting } = await import("../src/agent/runtime");
const { ScriptedModel } = await import("./scripted-model");
const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);

try {
  const owner = { id: `synthetic:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
  await seedSyntheticAge(payload, owner);
  const repo = new Repository(payload, owner);
  await new PrivacyService(repo).consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });

  const ordinary = { minor: false, crisis: false, dependency: false, overuse: false, exit: false, forget_context: false, image_requested: false };
  let generated = 0;
  const seenReviews: unknown[] = [];
  const service = new GreetingService(repo, async request => {
    generated++;
    await request.save({ greeting: "生成器已到达普通倾诉场景。", association: "工作安排", artifacts: [] });
  }, undefined, undefined, {
    moderate: async request => {
      if (request.stage === "output") return;
      seenReviews.push(request);
      assert.equal(request.stage, "input");
      assert.equal(request.serviceScope, true);
      assert.equal(request.interaction, true);
      return { serviceScope: "support", interaction: ordinary };
    },
  });
  const session = await service.createSession();
  const request = (text: string) => ({ sessionId: session.id, requestId: randomUUID(), mode: "platform" as const, input: { text, mediaIds: [] } });

  const ordinaryInputs = ordinarySemanticInputs;
  for (const text of ordinaryInputs) {
    const result = await service.generateGreeting(request(text));
    assert.equal(result.status, "completed");
    assert.match(result.greeting || "", /^生成器已到达/);
    assert.equal((result.input as { text?: string }).text, text, "ordinary disclosure must preserve full input");
  }
  assert.equal(generated, ordinaryInputs.length, "ordinary disclosures and product-help facts must reach the normal generator");
  assert.equal((await ageProfile(payload, owner.id))?.state, "adult", "ordinary semantic inputs must not mutate age");
  assert.equal((await repo.get("sessions", session.id)).memory, null, "ordinary or emotional forget language must not mutate memory");

  const latestReview = seenReviews.at(-1) as { texts: string[]; context?: string };
  assert.equal(latestReview.texts[0], ordinaryInputs.at(-1));
  const boundedContext = latestReview.context || "";
  const contextObject = JSON.parse(boundedContext) as Record<string, unknown>;
  assert.ok(boundedContext.includes("小说台词"), "semantic review must receive bounded recent context");
  assert.ok(!boundedContext.includes(ordinaryInputs[1]), "历史输入不应进入最新审核语境。");
  assert.ok(!("currentInput" in contextObject), "current input belongs only in texts[0]");

  const runtimeModel = new ScriptedModel({
    greeting: "这份压力听起来很沉。先照顾眼前情绪，不急着完成制作任务。",
    association: "普通情绪支持；引用中的制作语句不等于本轮生图请求。",
  });
  const runtimeService = new GreetingService(repo, args => runGreeting(args, runtimeModel), undefined, undefined, {
    moderate: async request => {
      if (request.stage === "output") return;
      return { serviceScope: "support" as const, interaction: ordinary };
    },
  });
  const runtimeSession = await runtimeService.createSession("语义图片边界");
  const runtimeInput = (text: string) => ({
    sessionId: runtimeSession.id,
    requestId: randomUUID(),
    mode: "platform" as const,
    input: { text, mediaIds: [] },
  });
  for (const text of [
    "同事昨天留言说：“请制作休息提醒卡。”我还没决定要不要做，先想聊聊怎么休息。",
    "老板让我制作广告海报，我很崩溃，帮我缓解焦虑吧",
  ]) {
    const result = await runtimeService.generateGreeting(runtimeInput(text));
    assert.equal(result.status, "completed");
    assert.match(result.greeting || "", /不急着完成制作任务/);
    assert.deepEqual(result.artifacts ?? [], []);
    const request = runtimeModel.requests.at(-1);
    assert.ok(request?.contents.some(content =>
      content.parts?.some(part => part.text?.includes(text))), "current full input must reach runGreeting");
  }
  assert.equal(runtimeModel.requests.length, 2, "ordinary semantic text must neither retry nor start image work");

  const crisis = { ...ordinary, crisis: true };
  const crisisService = new GreetingService(repo, async () => { throw new Error("crisis must not generate"); }, undefined, undefined, {
    moderate: async () => ({ serviceScope: "outside" as const, interaction: crisis }),
  });
  const crisisRow = await crisisService.generateGreeting(request("合成危机：我现在想伤害自己"));
  assert.equal(crisisRow.model, "product-guidance");
  assert.match(crisisRow.greeting || "", /眼前安全/);
  assert.equal((await payload.count({ collection: "safety-cases", overrideAccess: true, where: { stage: { equals: "interaction_crisis" } } })).totalDocs, 1);

  const dependency = { ...ordinary, dependency: true };
  const dependencyService = new GreetingService(repo, async () => { throw new Error("dependency notice must not generate"); }, undefined, undefined, {
    moderate: async () => ({ serviceScope: "support" as const, interaction: dependency }),
  });
  assert.match((await dependencyService.generateGreeting(request("我只想和你聊天，准备断绝朋友联系"))).greeting || "", /不能替代/);

  const overuse = { ...ordinary, overuse: true };
  const overuseService = new GreetingService(repo, async () => { throw new Error("overuse notice must not generate"); }, undefined, undefined, {
    moderate: async () => ({ serviceScope: "support" as const, interaction: overuse }),
  });
  const overuseNotice = (await overuseService.generateGreeting(request("我准备和你聊一整夜"))).greeting || "";
  assert.match(overuseNotice, /休息/);
  assert.doesNotMatch(overuseNotice, /连续使用|约 2 小时|两个小时/, "prospective semantic overuse must not claim measured elapsed time");

  const exit = { ...ordinary, exit: true };
  const exitService = new GreetingService(repo, async () => { throw new Error("exit must not generate"); }, undefined, undefined, {
    moderate: async () => ({ serviceScope: "support" as const, interaction: exit }),
  });
  assert.match((await exitService.generateGreeting(request("不聊了"))).greeting || "", /已停止本次聊天/);

  const beforeRows = (await repo.all("greetings")).length;
  for (const failure of [async () => undefined, async () => { throw new ContentReviewError(503, "semantic reviewer timed out"); }]) {
    const failing = new GreetingService(repo, async () => { throw new Error("invalid verdict must not generate"); }, undefined, undefined, {
      moderate: failure,
    });
    await assert.rejects(failing.generateGreeting(request("普通倾诉")), ContentReviewError);
  }
  assert.equal((await repo.all("greetings")).length, beforeRows, "missing or timed-out semantic verdict must not persist a turn");
  assert.equal((await ageProfile(payload, owner.id))?.state, "adult");
  assert.equal((await repo.get("sessions", session.id)).memory, null);

  const { SERVICE_SCOPE_REFUSAL, SERVICE_SCOPE_CLARIFICATION, SERVICE_SCOPE_VERSION } = await import("../src/domain/service-scope");
  for (const verdict of ["outside", "unclear"] as const) {
    const scoped = new GreetingService(repo, async () => { throw new Error("scope must stop generation"); }, undefined, undefined, {
      moderate: async () => ({ serviceScope: verdict, interaction: ordinary }),
    });
    const result = await scoped.generateGreeting(request("帮我解答数学题12+4-2"));
    assert.equal(result.greeting, verdict === "outside" ? SERVICE_SCOPE_REFUSAL : SERVICE_SCOPE_CLARIFICATION);
    assert.equal(result.promptVersion, SERVICE_SCOPE_VERSION);
  }

  console.log("PASS semantic interaction boundary: ordinary disclosures reach generator; safety/exit/failure paths stay closed; context is forwarded");
} finally {
  await payload.destroy();
  await rm(dir, { recursive: true, force: true });
}
