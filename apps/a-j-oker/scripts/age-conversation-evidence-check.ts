import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const dir = await mkdtemp(join(tmpdir(), "hello-age-evidence-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/check.db`;
process.env.PAYLOAD_SECRET = randomUUID() + randomUUID();
process.env.HELLO_DEPLOYED = "false";
process.env.HELLO_PRIVACY_DELETION_LEDGER = `${dir}/deletions.ndjson`;
process.env.DEEPSEEK_API_KEY = "synthetic-not-a-real-key";

const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { AJokerService } = await import("../src/domain/a-j-oker");
const { AgeService } = await import("../src/age/service");
const { OperationsService } = await import("../src/operations/service");
const { eraseOperationsEvidence } = await import("../src/operations/retention");
const { seedSyntheticAge } = await import("./synthetic-age");

const ordinary = { minor: false, crisis: false, dependency: false, overuse: false, exit: false, forget_context: false, image_requested: false, single_choice_only: false, single_open_question_only: false };
const payload = await cms();
try {
  const owner = { id: `synthetic:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
  await seedSyntheticAge(payload, owner);
  const repo = new Repository(payload, owner);
  let verdict = ordinary;
  const service = new AJokerService(repo, async request => {
    await request.save({ aJoker: "先前助手回应", association: "证据回归", artifacts: [] });
  }, undefined, undefined, { moderate: async () => ({ serviceScope: "support" as const, interaction: verdict }) });
  const session = await service.createSession();
  const priorTurnIds: number[] = [];
  for (let index = 1; index <= 105; index++) {
    const turn = await payload.create({ collection: "a-j-oker", overrideAccess: true, data: {
      owner: owner.id, sessionId: session.id, requestKey: `${owner.id}:${randomUUID()}`,
      fingerprint: `synthetic-history-${index}`, mode: "platform", status: "completed",
      input: { text: `先前用户消息 ${index}`, mediaIds: [] }, aJoker: "先前助手回应",
    } });
    priorTurnIds.push(turn.id);
  }
  verdict = { ...ordinary, minor: true };
  const requestId = randomUUID();
  const triggerText = "我现在还未满十八岁";
  await assert.rejects(service.generateAJoker({ sessionId: session.id, requestId, mode: "platform", input: { text: triggerText, mediaIds: [] } }), /年龄|复核|未成年/);

  const ageCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, where: { and: [
    { owner: { equals: owner.id } }, { stage: { equals: "age_review" } },
  ] } })).docs[0]!;
  assert.equal(ageCase.sessionId, session.id);
  assert.equal(ageCase.requestId, `${owner.id}:${requestId}`);
  const administrator = { ...await payload.create({ collection: "admins", overrideAccess: true, context: { helloAdminBootstrap: true }, data: {
    email: "age-evidence@example.invalid", password: randomUUID(), role: "reviewer",
  } }), collection: "admins" as const };
  assert.equal(administrator.role, "administrator", "bootstrap always creates an administrator");
  const reviewer = { ...await payload.create({ collection: "admins", overrideAccess: false, user: administrator, data: {
    email: "age-evidence-reviewer@example.invalid", password: randomUUID(), role: "reviewer",
  } }), collection: "admins" as const };
  const evidenceReadCount = async () => (await payload.count({ collection: "safety-audit", overrideAccess: true, where: { and: [
    { event: { equals: "evidence.read" } }, { target: { equals: `case:${ageCase.id}` } },
  ] } })).totalDocs;
  await assert.rejects(
    new OperationsService(payload).evidence(reviewer, ageCase.id, "未领取案件不得读取年龄证据"),
    /先领取案件/,
  );
  assert.equal(await evidenceReadCount(), 0, "denied reviewer access is not audited as a read");
  await new OperationsService(payload).evidence(administrator, ageCase.id, "管理员核对未领取案件的年龄证据");
  assert.equal(await evidenceReadCount(), 1, "administrator may read unassigned evidence and the read is audited");
  await payload.update({ collection: "safety-cases", id: ageCase.id, overrideAccess: true, context: { safetyInternal: true }, data: { assignedTo: reviewer.id } });
  const visible = await new OperationsService(payload).evidence(reviewer, ageCase.id, "核对触发年龄复核的有界会话证据");
  const conversation = visible.conversation as { sessionId: number; requestId: string; messages: { role: string; text: string; trigger: boolean; turnId?: number; timestamp?: string }[]; truncation: { omittedTurns: number; anyTextTruncated: boolean } };
  assert.equal(visible.provenance, "内部风险信号要求年龄复核。");
  assert.equal(conversation.sessionId, session.id);
  assert.equal(conversation.requestId, `${owner.id}:${requestId}`);
  assert.deepEqual(conversation.messages.map(message => [message.role, message.text, message.trigger]), [
    ["user", "先前用户消息 102", false], ["assistant", "先前助手回应", false],
    ["user", "先前用户消息 103", false], ["assistant", "先前助手回应", false],
    ["user", "先前用户消息 104", false], ["assistant", "先前助手回应", false],
    ["user", "先前用户消息 105", false], ["assistant", "先前助手回应", false],
    ["user", triggerText, true],
  ]);
  assert.equal(conversation.truncation.omittedTurns, 101);
  assert.equal(conversation.truncation.anyTextTruncated, false);
  assert.deepEqual(conversation.messages.slice(0, -1).map(message => message.turnId), priorTurnIds.slice(-4).flatMap(id => [id, id]));
  assert.ok(conversation.messages.slice(0, -1).every(message => typeof message.timestamp === "string"));
  assert.equal(await evidenceReadCount(), 2, "assigned reviewer access is audited after the administrator read");

  const stranger = { id: `synthetic:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
  await seedSyntheticAge(payload, stranger);
  await assert.rejects(new AgeService(payload, stranger).requireAdditionalVerification({
    kind: "conversation", sessionId: session.id, requestId, triggerText: "不得写入的伪造触发文本",
  }), /不属于当前身份/);
  assert.equal((await payload.count({ collection: "safety-cases", overrideAccess: true, where: { owner: { equals: stranger.id } } })).totalDocs, 0);

  const legacyOwner = { id: `synthetic:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
  await seedSyntheticAge(payload, legacyOwner);
  await new AgeService(payload, legacyOwner).requireAdditionalVerification();
  const legacyCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, where: { owner: { equals: legacyOwner.id } } })).docs[0]!;
  await payload.update({ collection: "safety-cases", id: legacyCase.id, overrideAccess: true, context: { safetyInternal: true }, data: { assignedTo: reviewer.id } });
  const legacy = await new OperationsService(payload).evidence(reviewer, legacyCase.id, "确认旧案件不会猜测或补填其他会话");
  assert.equal(legacy.conversation, null);
  assert.match(String(legacy.transcriptUnavailable), /未保存|不能.*猜测/);

  await payload.update({ collection: "safety-cases", id: ageCase.id, overrideAccess: true, context: { safetyInternal: true }, data: { retainUntil: new Date(Date.now() - 1_000).toISOString() } });
  const expired = await new OperationsService(payload).evidence(reviewer, ageCase.id, "确认到期证据不会返回任何对话正文");
  assert.equal(expired.unavailable, true);
  assert.equal("conversation" in expired, false);
  assert.equal(await evidenceReadCount(), 3, "expired evidence read remains audited");
  await payload.update({ collection: "safety-cases", id: ageCase.id, overrideAccess: true, context: { safetyInternal: true }, data: { retainUntil: null } });

  await eraseOperationsEvidence(payload, owner.id, "隔离回归验证证据清理");
  const purged = await new OperationsService(payload).evidence(reviewer, ageCase.id, "确认清理后不再返回任何对话正文");
  assert.equal(purged.unavailable, true);
  assert.equal(await evidenceReadCount(), 4, "purged evidence read remains audited");
} finally {
  await payload.destroy();
}
