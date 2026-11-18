import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "@payloadcms/db-sqlite";

const isolatedRoot = path.join(tmpdir(), "aj-filing-review-20261118");
await mkdir(isolatedRoot, { recursive: true });
const directory = await mkdtemp(path.join(isolatedRoot, "appeal-review-check-"));
process.env.HELLO_DATABASE_URI = `file:${directory}/isolated.db`;
process.env.PAYLOAD_SECRET = "isolated-appeal-review-test-only";
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("appeal-review-check blocks all network access"); };

const { cms } = await import("../src/cms/client");
const { OperationsService, transaction } = await import("../src/operations/service");
const { AgeService, ageProfile } = await import("../src/age/service");
const { wechatLogin } = await import("../src/age/wechat");
const { ageNotice } = await import("../src/age/policy");
const { authenticate } = await import("../src/server/auth");
const payload = await cms();
const ops = new OperationsService(payload);
let checks = 0;
const pass = (label: string) => { checks++; console.log(`✓ ${label}`); };
const caseByReceipt = async (receipt: string) => {
  const row = (await payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, where: { receipt: { equals: receipt } } })).docs[0];
  assert.ok(row);
  return row;
};
const seedCase = async (owner: string, status: "resolved" | "review", parentId: number | null, lastReviewer: number) => {
  const receipt = randomUUID();
  await payload.db.drizzle.run(sql`
    INSERT INTO safety_cases (receipt, owner, source, status, severity, category, stage, revision, parent_id, last_reviewer)
    VALUES (${receipt}, ${owner}, 'moderation', ${status}, 'normal', 'other', 'synthetic_ancestry', 0, ${parentId}, ${lastReviewer})
  `);
  return caseByReceipt(receipt);
};
const nativeReq = (token?: string) => ({ headers: new Headers(token ? { Authorization: `Bearer ${token}` } : {}) }) as Request;
const ageSubject = async () => {
  const login = await wechatLogin(payload, nativeReq(), {
    code: "synthetic-age-appeal", consent: true, migrateCurrent: true,
    get noticeVersion() { return ageNotice().version; },
  }, async () => randomUUID());
  const owner = await authenticate(payload, nativeReq(login.token));
  return { owner, service: new AgeService(payload, owner, async () => { throw new Error("age appeal check must not invoke a provider"); }) };
};
const latestAgeCase = async (owner: string) => {
  const row = (await payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, sort: "-id", where: {
    and: [{ owner: { equals: owner } }, { stage: { equals: "age_review" } }],
  } })).docs[0];
  assert.ok(row);
  return row;
};

try {
  const administrator = { ...await payload.create({
    collection: "admins", overrideAccess: true, context: { helloAdminBootstrap: true },
    data: { role: "reviewer", email: "a@example.test", password: "synthetic-only-123" },
  }), collection: "admins" as const };
  assert.equal((await payload.findByID({ collection: "admins", id: administrator.id, overrideAccess: true })).role, "administrator");
  const appealReviewer = { ...await payload.create({
    collection: "admins", overrideAccess: false, user: administrator,
    data: { role: "appeal_reviewer", email: "b@example.test", password: "synthetic-only-123" },
  }), collection: "admins" as const };
  assert.equal((await payload.findByID({ collection: "admins", id: appealReviewer.id, overrideAccess: true })).role, "appeal_reviewer");
  pass("首个引导账号实际成为管理员；第二个账号由管理员创建为独立申诉复核员");

  await assert.rejects(() => ops.configure(appealReviewer, {
    acceptanceHours: 8, resolutionHours: 48, feedbackHours: 24, evidenceDays: 7,
    staffing: "合成值班安排", retentionBasis: "合成测试最小证据保留", reason: "合成配置权限测试",
  }), { status: 403 });
  await assert.rejects(() => payload.find({ collection: "safety-rules", overrideAccess: false, user: appealReviewer }));
  await assert.rejects(() => payload.update({
    collection: "admins", id: appealReviewer.id, overrideAccess: false, user: appealReviewer,
    data: { email: "escalate@example.test" },
  }));
  pass("独立申诉复核员不能配置运营、读取规则或更新账号");

  const owner = { id: `appeal-owner:${randomUUID()}`, auth: "cookie" as const };
  const original = await transaction(payload, (req) => ops.createCase({
    owner: owner.id, source: "moderation", stage: "input", category: "fraud", decision: "block",
  }, "合成申诉复核角色初始限制材料", req));
  assert.equal(original.revision, 0);
  assert.deepEqual(await ops.queue(appealReviewer, {}), []);
  await assert.rejects(() => ops.action(appealReviewer, Number(original.id), { revision: 0, action: "claim", reason: "独立角色不能领取首次决定" }), { status: 403 });
  assert.equal((await caseByReceipt(String(original.receipt))).status, "pending");
  pass("独立申诉复核员不能看到或领取首次决定案件");

  await ops.action(administrator, Number(original.id), { revision: 0, action: "claim", reason: "管理员领取首次生成限制案件" });
  await ops.action(administrator, Number(original.id), { revision: 1, action: "restrict", reason: "首次决定由管理员限制该合成身份" });
  const enforcement = (await payload.find({ collection: "safety-enforcements", overrideAccess: true, limit: 1, where: { caseId: { equals: original.id } } })).docs[0];
  assert.ok(enforcement?.active);
  pass("初始生成限制仍由系统管理员作出并持久生效");

  const firstAppeal = await ops.complain(owner, {
    kind: "appeal", parentReceipt: String(original.receipt), category: "other", description: "合成申诉请求复核",
  });
  const firstAppealRow = (await ops.queue(appealReviewer, {})).find((row) => row.receipt === firstAppeal.receipt);
  assert.ok(firstAppealRow?.parentId);
  await ops.action(appealReviewer, Number(firstAppealRow.id), { revision: 0, action: "claim", reason: "独立申诉复核员领取该申诉" });
  await assert.rejects(() => ops.action(appealReviewer, Number(firstAppealRow.id), { revision: 0, action: "unrestrict", reason: "旧修订号不能覆盖申诉案件" }), { status: 409 });
  const released = await ops.action(appealReviewer, Number(firstAppealRow.id), { revision: 1, action: "unrestrict", reason: "独立复核确认可解除原限制", reply: "已完成独立复核并解除生成限制。" });
  assert.equal(released.status, "resolved");
  assert.equal((await payload.findByID({ collection: "safety-enforcements", id: enforcement.id, overrideAccess: true })).active, false);
  const releaseAudit = (await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: {
    and: [{ actor: { equals: `admin:${appealReviewer.id}` } }, { event: { equals: "case.unrestrict" } }, { target: { equals: `case:${firstAppealRow.id}` } }],
  } })).docs[0];
  assert.ok(releaseAudit);
  pass("独立申诉复核员可领取申诉、被修订号阻断重放并持久解除与审计原限制");

  const secondAppeal = await ops.complain(owner, {
    kind: "appeal", parentReceipt: String(original.receipt), category: "other", description: "再次合成申诉复核",
  });
  const secondAppealRow = (await ops.queue(appealReviewer, {})).find((row) => row.receipt === secondAppeal.receipt);
  assert.ok(secondAppealRow);
  await ops.action(appealReviewer, Number(secondAppealRow.id), { revision: 0, action: "claim", reason: "独立申诉复核员先领取复核" });
  await ops.action(appealReviewer, Number(secondAppealRow.id), { revision: 1, action: "review", reason: "转交原管理员验证独立约束" });
  await ops.action(administrator, Number(secondAppealRow.id), { revision: 2, action: "claim", reason: "原管理员尝试处理本人限制" });
  const beforeSelfReject = await caseByReceipt(secondAppeal.receipt);
  await assert.rejects(() => ops.action(administrator, Number(secondAppealRow.id), { revision: 3, action: "unrestrict", reason: "原管理员不能恢复本人限制" }), { status: 403 });
  const afterSelfReject = await caseByReceipt(secondAppeal.receipt);
  assert.deepEqual({ ...afterSelfReject, updatedAt: undefined }, { ...beforeSelfReject, updatedAt: undefined });
  pass("原决定人自助恢复被拒绝，申诉案件状态与修订号不变");

  const ancestryOwner = `ancestry:${randomUUID()}`;
  const root = await seedCase(ancestryOwner, "resolved", null, Number(administrator.id));
  const wrongOwnerChild = await seedCase(`other:${randomUUID()}`, "review", Number(root.id), Number(appealReviewer.id));
  const missingChild = await seedCase(ancestryOwner, "review", 99_999_999, Number(appealReviewer.id));
  const cyclicChild = await seedCase(ancestryOwner, "review", null, Number(appealReviewer.id));
  await payload.db.drizzle.run(sql`UPDATE safety_cases SET parent_id = ${Number(cyclicChild.id)} WHERE id = ${Number(cyclicChild.id)}`);
  for (const child of [wrongOwnerChild, missingChild, cyclicChild]) {
    await assert.rejects(() => ops.action(appealReviewer, Number(child.id), { revision: 0, action: "claim", reason: "不安全父级关系必须失败关闭" }), { status: 409 });
  }
  pass("跨身份、缺失和成环父级关系均失败关闭");

  const unknownActorOwner = `unknown-actor:${randomUUID()}`;
  const unknownActorRoot = await seedCase(unknownActorOwner, "resolved", null, Number(administrator.id));
  await payload.db.drizzle.run(sql`UPDATE safety_cases SET last_reviewer = NULL WHERE id = ${Number(unknownActorRoot.id)}`);
  const unknownActorChild = await seedCase(unknownActorOwner, "review", Number(unknownActorRoot.id), Number(appealReviewer.id));
  await assert.rejects(() => ops.action(appealReviewer, Number(unknownActorChild.id), { revision: 0, action: "claim", reason: "未知原决定人不能进入申诉恢复" }), { status: 409 });
  pass("已结父案缺少可归属决定人时申诉失败关闭");

  const initialAge = await ageSubject();
  await initialAge.service.requireAdditionalVerification();
  const initialAgeRoot = await latestAgeCase(initialAge.owner.id);
  assert.equal(initialAgeRoot.source, "moderation");
  assert.equal(initialAgeRoot.parentId, null);
  await ops.action(administrator, Number(initialAgeRoot.id), { revision: 0, action: "claim", reason: "管理员领取初始自动年龄风险" });
  await ops.action(administrator, Number(initialAgeRoot.id), { revision: 1, action: "restore_age_access", reason: "初始自动年龄风险可由管理员直接恢复", reply: "管理员已人工核实并恢复年龄权限。" });
  assert.equal((await ageProfile(payload, initialAge.owner.id))?.state, "adult");
  pass("初始自动年龄风险仍可由管理员领取后直接恢复且不调用供应商");

  const legacyAgeOwner = `legacy-age:${randomUUID()}`;
  const legacyAgeRoot = await seedCase(legacyAgeOwner, "review", null, Number(administrator.id));
  await payload.db.drizzle.run(sql`
    UPDATE safety_cases
    SET source = 'complaint', stage = 'age_review', action = 'maintain_age_restriction',
        last_reviewer = NULL, assigned_to = ${Number(administrator.id)}
    WHERE id = ${Number(legacyAgeRoot.id)}
  `);
  const legacyBefore = await caseByReceipt(String(legacyAgeRoot.receipt));
  const legacyAuditBefore = await payload.count({ collection: "safety-audit", overrideAccess: true, where: { target: { equals: `case:${legacyAgeRoot.id}` } } });
  await assert.rejects(() => ops.action(administrator, Number(legacyAgeRoot.id), { revision: 0, action: "restore_age_access", reason: "遗留已记录年龄决定缺少决定人，必须失败关闭", reply: "不应恢复未知决定人作出的限制。" }), { status: 409 });
  const legacyAfter = await caseByReceipt(String(legacyAgeRoot.receipt));
  assert.equal(legacyAfter.revision, legacyBefore.revision);
  assert.equal(legacyAfter.source, legacyBefore.source);
  assert.equal(legacyAfter.stage, legacyBefore.stage);
  assert.equal(legacyAfter.action, legacyBefore.action);
  assert.equal(legacyAfter.status, legacyBefore.status);
  assert.equal(legacyAfter.parentId, legacyBefore.parentId);
  assert.equal(legacyAfter.lastReviewer, legacyBefore.lastReviewer);
  assert.equal(legacyAfter.assignedTo, legacyBefore.assignedTo);
  assert.equal((await payload.count({ collection: "safety-audit", overrideAccess: true, where: { target: { equals: `case:${legacyAgeRoot.id}` } } })).totalDocs, legacyAuditBefore.totalDocs);
  pass("缺少决定人的遗留年龄决定重开后仍不能被当作首次决定恢复");

  const appealedAge = await ageSubject();
  await appealedAge.service.requireAdditionalVerification();
  const appealedAgeRoot = await latestAgeCase(appealedAge.owner.id);
  await ops.action(administrator, Number(appealedAgeRoot.id), { revision: 0, action: "claim", reason: "管理员维持初始年龄限制" });
  await ops.action(administrator, Number(appealedAgeRoot.id), { revision: 1, action: "maintain_age_restriction", reason: "初始材料不足以解除年龄限制", reply: "维持年龄限制，可再次申请复核。" });
  const requestedAppeal = await appealedAge.service.requestReview();
  assert.ok(requestedAppeal.review?.receipt);
  const ageAppeal = await caseByReceipt(requestedAppeal.review.receipt);
  assert.equal(ageAppeal.parentId, appealedAgeRoot.id);
  assert.equal(ageAppeal.source, "appeal");
  await ops.action(appealReviewer, Number(ageAppeal.id), { revision: 0, action: "claim", reason: "独立复核员领取年龄申诉" });
  await ops.action(appealReviewer, Number(ageAppeal.id), { revision: 1, action: "review", reason: "先转交验证原管理员不能自助恢复" });
  await ops.action(administrator, Number(ageAppeal.id), { revision: 2, action: "claim", reason: "原管理员领取本人维持的年龄申诉" });
  await assert.rejects(() => ops.action(administrator, Number(ageAppeal.id), { revision: 3, action: "restore_age_access", reason: "原管理员不能恢复本人维持的限制", reply: "不应由原管理员恢复。" }), { status: 403 });
  await ops.action(administrator, Number(ageAppeal.id), { revision: 3, action: "review", reason: "原管理员转交独立年龄复核" });
  await ops.action(appealReviewer, Number(ageAppeal.id), { revision: 4, action: "claim", reason: "独立复核员再次领取年龄申诉" });
  await ops.action(appealReviewer, Number(ageAppeal.id), { revision: 5, action: "restore_age_access", reason: "独立复核确认可恢复年龄权限", reply: "独立复核已完成并恢复年龄权限。" });
  const appealedProfile = await ageProfile(payload, appealedAge.owner.id);
  assert.equal(appealedProfile?.state, "adult");
  assert.equal(appealedProfile?.assurance, "manual_administrator_assurance");
  const ageAppealAudit = (await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: {
    and: [{ actor: { equals: `admin:${appealReviewer.id}` } }, { event: { equals: "case.restore_age_access" } }, { target: { equals: `case:${ageAppeal.id}` } }],
  } })).docs[0];
  assert.equal((ageAppealAudit?.metadata as Record<string, unknown> | undefined)?.providerInvoked, false);
  pass("年龄维持后的真实申诉会生成子案，独立复核可恢复且原管理员不能自助恢复");

  const transferredAge = await ageSubject();
  await transferredAge.service.requireAdditionalVerification();
  const transferredRoot = await latestAgeCase(transferredAge.owner.id);
  await ops.action(administrator, Number(transferredRoot.id), { revision: 0, action: "claim", reason: "管理员领取后转交年龄复核" });
  await ops.action(administrator, Number(transferredRoot.id), { revision: 1, action: "review", reason: "根案仅转交不形成年龄决定" });
  assert.ok((await ops.queue(appealReviewer, { status: "review" })).some((row) => row.id === transferredRoot.id));
  await ops.action(appealReviewer, Number(transferredRoot.id), { revision: 2, action: "claim", reason: "独立复核员领取仅转交的根案" });
  await assert.rejects(() => ops.action(appealReviewer, Number(transferredRoot.id), { revision: 3, action: "permit_age_reverification", reason: "独立复核员不能作出首次年龄决定", reply: "不能在根案首次批准核验。" }), { status: 403 });
  const transferredAfterReject = await caseByReceipt(String(transferredRoot.receipt));
  assert.equal(transferredAfterReject.status, "review");
  assert.equal(transferredAfterReject.revision, 3);
  assert.equal((await ageProfile(payload, transferredAge.owner.id))?.state, "needs_review");
  pass("根案仅转交为待复核不能让独立角色作出首次年龄结论");

  const launderAge = await ageSubject();
  await launderAge.service.requireAdditionalVerification();
  const launderRoot = await latestAgeCase(launderAge.owner.id);
  await ops.action(administrator, Number(launderRoot.id), { revision: 0, action: "claim", reason: "管理员作出最早年龄决定" });
  await ops.action(administrator, Number(launderRoot.id), { revision: 1, action: "maintain_age_restriction", reason: "最早年龄决定由原管理员作出", reply: "维持年龄限制。" });
  await ops.action(administrator, Number(launderRoot.id), { revision: 2, action: "review", reason: "重开根案验证最早决定不可洗白" });
  await ops.action(appealReviewer, Number(launderRoot.id), { revision: 3, action: "claim", reason: "独立复核员领取重开根案" });
  await ops.action(appealReviewer, Number(launderRoot.id), { revision: 4, action: "maintain_age_restriction", reason: "独立复核员在重开根案维持限制", reply: "独立复核后仍维持年龄限制。" });
  const unrelatedResolved = await seedCase(`unrelated:${randomUUID()}`, "resolved", null, Number(administrator.id));
  assert.equal((await payload.find({ collection: "safety-cases", overrideAccess: false, user: appealReviewer, limit: 1, where: { receipt: { equals: unrelatedResolved.receipt } } })).docs.length, 0);
  assert.equal((await payload.find({ collection: "safety-cases", overrideAccess: false, user: appealReviewer, limit: 1, where: { receipt: { equals: launderRoot.receipt } } })).docs.length, 1);
  await ops.action(appealReviewer, Number(launderRoot.id), { revision: 5, action: "feedback", reason: "独立复核员补充本人结果反馈", reply: "这是独立复核员的年龄限制结果反馈。" });
  await ops.action(administrator, Number(launderRoot.id), { revision: 6, action: "review", reason: "再次重开验证最早决定仍生效" });
  await ops.action(administrator, Number(launderRoot.id), { revision: 7, action: "claim", reason: "原管理员尝试恢复最早决定" });
  await assert.rejects(() => ops.action(administrator, Number(launderRoot.id), { revision: 8, action: "restore_age_access", reason: "原管理员不能借重开洗白最早决定", reply: "不应恢复本人最早限制。" }), { status: 403 });
  const earliestDecision = (await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, sort: "id", where: {
    and: [{ target: { equals: `case:${launderRoot.id}` } }, { event: { in: ["case.maintain_age_restriction", "case.restore_age_access"] } }],
  } })).docs[0];
  assert.equal(earliestDecision?.actor, `admin:${administrator.id}`);
  pass("重开根案不会洗白最早年龄决定；独立复核员仅可见本人已结根案和必要申诉范围");

  console.log(`\n${checks} 组 appeal_reviewer 独立复核检查通过（临时 SQLite；网络已阻断；包含通用与年龄申诉场景）。`);
} finally {
  globalThis.fetch = originalFetch;
  await payload.destroy();
}
