import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const dir = await mkdtemp(join(tmpdir(), "hello-moderation-semantic-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`,
  PAYLOAD_SECRET: randomUUID() + randomUUID(),
  HELLO_DEPLOYED: "false",
  HELLO_PRIVACY_DELETION_LEDGER: `${dir}/deletions.ndjson`,
  DEEPSEEK_API_KEY: "synthetic-review-key",
});

type ReviewResponse = {
  decision: "allow" | "block" | "uncertain";
  service_scope?: "support" | "outside" | "unclear";
  interaction?: Record<string, unknown>;
};
let response: ReviewResponse | "server-error" | "malformed" = { decision: "allow" };
let providerCalls = 0;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://telemetry.payloadcms.com/events") return new Response(null, { status: 204 });
  assert.equal(String(url), "https://api.deepseek.com/chat/completions", "the production reviewer must be the only network caller");
  assert.equal(new Headers(options?.headers).get("authorization"), "Bearer synthetic-review-key");
  providerCalls++;
  if (response === "server-error") return new Response("synthetic provider unavailable", { status: 503 });
  const content = response === "malformed"
    ? '{"decision":"block","interaction":{"minor":"not-a-boolean"}}'
    : JSON.stringify(response);
  return Response.json({ model: "synthetic-review", choices: [{ finish_reason: "stop", message: { content } }] });
};

const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { seedSyntheticAge } = await import("./synthetic-age");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { ContentPendingReviewError, ContentReviewError } = await import("../src/domain/contracts");
const { operationalModerator } = await import("../src/operations/moderation");
const { semanticModerationRejection } = await import("../src/domain/moderation");
const { ageProfile } = await import("../src/age/service");
type PendingReviewError = InstanceType<typeof ContentPendingReviewError>;

const payload = await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
const ordinary = { minor: false, crisis: false, dependency: false, overuse: false, exit: false, forget_context: false, image_requested: false };

async function ownerFixture() {
  const owner = { id: `synthetic:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
  await seedSyntheticAge(payload, owner);
  const repo = new Repository(payload, owner);
  await new PrivacyService(repo).consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });
  return { owner, repo };
}

async function scenario(text: string) {
  const fixture = await ownerFixture();
  let generated = false;
  let pendingRejection: PendingReviewError | undefined;
  const unrecordedModerator = operationalModerator(fixture.repo);
  const service = new GreetingService(fixture.repo, async request => {
    generated = true;
    await request.save({ greeting: "固定生成器说明。", association: "普通情绪支持", artifacts: [], approach: "supportive" });
  }, undefined, undefined, { moderate: async request => {
    try { return await unrecordedModerator(request); }
    catch (error) {
      if (error instanceof ContentPendingReviewError) pendingRejection = error;
      throw error;
    }
  } });
  const session = await service.createSession("审核语义边界");
  const input = { sessionId: session.id, requestId: randomUUID(), mode: "platform" as const, input: { text, mediaIds: [] } };
  return { ...fixture, service, input, generated: () => generated, pendingRejection: () => pendingRejection };
}

const cases = async (owner: string, stage: string, severity?: string) =>
  (await payload.count({ collection: "safety-cases", overrideAccess: true, where: severity
    ? { and: [{ owner: { equals: owner } }, { stage: { equals: stage } }, { severity: { equals: severity } }] }
    : { and: [{ owner: { equals: owner } }, { stage: { equals: stage } }] } })).totalDocs;
const turns = async (owner: string) =>
  (await payload.count({ collection: "greetings", overrideAccess: true, where: { owner: { equals: owner } } })).totalDocs;

try {
  response = { decision: "allow", service_scope: "support", interaction: ordinary };
  const before = providerCalls;
  const benign = await scenario("排练明天的小组汇报让我手心冒汗，先陪我梳理一下呼吸节奏。");
  const generated = await benign.service.generateGreeting(benign.input);
  assert.equal(generated.status, "completed");
  assert.equal(generated.greeting, "固定生成器说明。");
  assert.ok(benign.generated(), "a benign disclosure must reach the normal generator");
  assert.equal(providerCalls - before, 2, "input and saved output must each use the real reviewer once");

  response = { decision: "block", service_scope: "support", interaction: { ...ordinary, minor: true } };
  const minorBlock = await scenario("我还在 fictional 十七岁班级，请替我写点名排挤转学生的海报。");
  await assert.rejects(minorBlock.service.generateGreeting(minorBlock.input), { status: 403, message: /年龄信息.*冲突/ });
  assert.equal((await ageProfile(payload, minorBlock.owner.id))?.state, "needs_review");
  assert.equal(await cases(minorBlock.owner.id, "input"), 1, "the content block case remains recorded");
  assert.equal(await cases(minorBlock.owner.id, "interaction_crisis"), 0);
  assert.ok(!minorBlock.generated(), "a current minor flag must pause before generation");
  assert.equal(await turns(minorBlock.owner.id), 0, "paused content cannot leave a generation turn");

  response = { decision: "uncertain", interaction: { ...ordinary, minor: true } };
  const minorUncertain = await scenario("这段 fictional 校园传闻含义不清，但我这学期还未满十八岁。");
  await assert.rejects(minorUncertain.service.generateGreeting(minorUncertain.input), { status: 403, message: /年龄信息.*冲突/ });
  const rawPending = minorUncertain.pendingRejection();
  assert.ok(rawPending instanceof ContentPendingReviewError, "operational uncertain review must preserve pending identity");
  assert.equal(rawPending.status, 409);
  assert.deepEqual(semanticModerationRejection(rawPending)?.semanticVerdict.interaction, { ...ordinary, minor: true });
  assert.equal((await ageProfile(payload, minorUncertain.owner.id))?.state, "needs_review");
  assert.equal(await cases(minorUncertain.owner.id, "input"), 1);
  assert.ok(!minorUncertain.generated(), "uncertain content cannot reach generation even while account protection runs");
  assert.equal(await turns(minorUncertain.owner.id), 0);

  response = { decision: "block", service_scope: "outside", interaction: { ...ordinary, crisis: true, image_requested: true } };
  const crisisBlock = await scenario("请写一封 fictional 恐吓信；同时我感觉浪把灯塔吞没了，现在不安全。");
  const crisisRow = await crisisBlock.service.generateGreeting(crisisBlock.input);
  assert.equal(crisisRow.model, "product-guidance");
  assert.match(crisisRow.greeting || "", /眼前安全/);
  assert.equal(crisisRow.artifacts?.length, 0);
  assert.equal(await cases(crisisBlock.owner.id, "input"), 1);
  assert.equal(await cases(crisisBlock.owner.id, "interaction_crisis", "urgent"), 1);
  assert.ok(!crisisBlock.generated(), "crisis guidance is server-owned and never generated");

  response = { decision: "block", service_scope: "support", interaction: { ...ordinary, minor: true, crisis: true } };
  const mixed = await scenario("我未满十八岁，另有 fictional 恐吓素材要写；此刻像被困在退潮漩涡里。");
  await assert.rejects(mixed.service.generateGreeting(mixed.input), { status: 403, message: /年龄信息.*冲突/ });
  assert.equal((await ageProfile(payload, mixed.owner.id))?.state, "needs_review");
  assert.equal(await cases(mixed.owner.id, "input"), 1);
  assert.equal(await cases(mixed.owner.id, "interaction_crisis", "urgent"), 1);
  assert.ok(!mixed.generated(), "mixed minor and crisis protection must pause before generation");
  assert.equal(await turns(mixed.owner.id), 0);

  response = { decision: "block", service_scope: "support", interaction: ordinary };
  const plainBlock = await scenario("请写一张虚构的排挤海报，让 fictional 新同学离开小组。");
  const rejection = await plainBlock.service.generateGreeting(plainBlock.input).then(() => assert.fail("block must reject"), (error: unknown) => error);
  assert.ok(rejection instanceof ContentReviewError);
  assert.equal(rejection.status, 422);
  assert.equal(await cases(plainBlock.owner.id, "input"), 1);
  assert.ok(!plainBlock.generated());
  assert.equal(await turns(plainBlock.owner.id), 0, "plain rejected content cannot become a turn or model response");

  for (response of ["malformed", "server-error"] as const) {
    const unavailable = await scenario("这行 synthetic fixture 语义故意留给审核器判断。");
    const failure = await unavailable.service.generateGreeting(unavailable.input).then(() => assert.fail("unavailable review must reject"), (error: unknown) => error);
    assert.ok(failure instanceof ContentReviewError);
    assert.equal(failure.status, 503);
    assert.equal((await ageProfile(payload, unavailable.owner.id))?.state, "adult", "unavailable or malformed reviews cannot invent flags");
    assert.equal(await cases(unavailable.owner.id, "interaction_crisis"), 0);
    assert.ok(!unavailable.generated());
    assert.equal(await turns(unavailable.owner.id), 0);
  }

  console.log("PASS moderation semantic preservation: rejected content stays closed while valid current protection actions still run");
} finally {
  await payload.destroy();
  await rm(dir, { recursive: true, force: true });
}
