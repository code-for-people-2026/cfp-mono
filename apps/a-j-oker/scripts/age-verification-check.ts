// Synthetic identity/provider inputs are injected only into this isolated script.
// No application endpoint or environment flag can return a synthetic adult result.
import { sql } from "@payloadcms/db-sqlite";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(tmpdir(), "aj-age-isolated-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/age.db`;
process.env.PAYLOAD_SECRET = "isolated-age-test-only";
process.env.HELLO_DEPLOYED = "false";
process.env.HELLO_PRIVACY_DELETION_LEDGER = `${dir}/deleted.ndjson`;
process.env.HELLO_MEDIA_STORAGE = "database";
const { cms } = await import("../src/cms/client");
const { AgeService, ageProfile } = await import("../src/age/service");
const { wechatLogin } = await import("../src/age/wechat");
const { ageNotice } = await import("../src/age/policy");
const { privacyPolicy } = await import("../src/privacy/policy");
const { PrivacyService, withRecoveredOwner } = await import("../src/privacy/service");
const { mintCredential, authenticate, COOKIE } = await import("../src/server/auth");
const { Repository } = await import("../src/cms/repository");
const { GET, POST } = await import("../src/app/api/hello/[...path]/route");
const { POST: mcpPost } = await import("../src/app/api/mcp/route");
const { OperationsService } = await import("../src/operations/service");
const { caseOperationLabel, operationLabels } = await import("../src/operations/admin-presentation");
const payload = await cms();
const nativeReq = (token?: string) => new Request("http://127.0.0.1:3310/api/hello/wechat-login", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const creds = { get noticeVersion() { return ageNotice().version; }, code: "synthetic-code", consent: true, migrateCurrent: true };
const identity = { name: "仅限合成测试", idCard: "000000200001010000" };
function http(token: string, path: string[], body?: unknown) {
  const req = new Request(`http://127.0.0.1:3310/api/hello/${path.join("/")}`, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return (body === undefined ? GET : POST)(req, { params: Promise.resolve({ path }) });
}
async function fresh() {
  const token = await wechatLogin(payload, nativeReq(), creds, async () => randomUUID());
  const owner = await authenticate(payload, nativeReq(token.token));
  return { token, owner };
}
async function challenge(service: InstanceType<typeof AgeService>, declaration = "adult") {
  return service.challenge({ declaration, consent: true, noticeVersion: ageNotice().version });
}
async function assertProvenance(receipt: string, expected: { source: string; actor: string; reason: string; evidence: string }) {
  const row = (await payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, where: { receipt: { equals: receipt } } })).docs[0]!;
  assert.equal(row.source, expected.source);
  assert.equal(caseOperationLabel(String(row.source), String(row.stage)).includes("年龄复核"), true);
  const evidence = (await payload.find({ collection: "safety-evidence", overrideAccess: true, limit: 1, where: { caseId: { equals: row.id } } })).docs[0]!;
  assert.equal(evidence.excerpt, expected.evidence);
  const entry = (await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: { and: [
    { event: { equals: "case.created" } }, { target: { equals: `case:${row.id}` } },
  ] } })).docs[0]!;
  assert.equal(entry.actor, expected.actor); assert.equal(entry.reason, expected.reason);
  return row;
}
try {
  const old = await mintCredential(payload, "miniapp");
  const oldRepo = new Repository(payload, { id: old.owner, auth: "miniapp" });
  const oldSession = await oldRepo.create("sessions", { title: "合成旧记录" });
  const stranger = await mintCredential(payload, "miniapp");
  await assert.rejects(() => wechatLogin(payload, nativeReq(), { ...creds, owner: old.owner }, async () => "forged"));
  await assert.rejects(() => wechatLogin(payload, nativeReq("invented-token"), creds, async () => "forged"));
  for (const route of [["sessions"], ["sessions", String(oldSession.id)], ["context", String(oldSession.id)], ["profile"]]) assert.equal((await http(old.token, route)).status, 403);
  assert.equal((await http(old.token, ["privacy"])).status, 200);
  const linked = await wechatLogin(payload, nativeReq(old.token), creds, async () => "synthetic-wx-a");
  assert.equal(linked.owner, old.owner); assert.equal(linked.history, "kept");
  await assert.rejects(() => authenticate(payload, nativeReq(old.token)), /无效|过期/);
  const owner = await authenticate(payload, nativeReq(linked.token));
  assert.equal(owner.wechatKey, "synthetic-wx-a");
  assert.equal((await new Repository(payload, owner).get("sessions", oldSession.id)).title, "合成旧记录");
  const restored = await wechatLogin(payload, nativeReq(stranger.token), creds, async () => "synthetic-wx-a");
  assert.equal(restored.owner, linked.owner); assert.equal(restored.history, "wechat_restored");
  const different = await wechatLogin(payload, nativeReq(linked.token), creds, async () => "synthetic-wx-b");
  assert.notEqual(different.owner, linked.owner);
  const differentOwner = await authenticate(payload, nativeReq(different.token));
  await assert.rejects(() => new Repository(payload, differentOwner).get("sessions", oldSession.id), /不存在|无权/);
  console.log("✓ 微信身份绑定、有效旧凭证迁移、旧令牌撤销、微信恢复与跨账号隔离");

  const service = new AgeService(payload, owner, async () => ({ state: "adult", reference: "synthetic-reference" }));
  assert.equal((await service.status()).allowed, false);
  const absent = await challenge(service); assert.equal(absent.challenge, null); assert.equal(absent.status.state, "unavailable");
  assert.equal((await http(linked.token, ["age", "submit"], { ...identity, challenge: randomUUID(), state: "adult" })).status, 400);
  Object.assign(process.env, { HELLO_AGE_SECRET_ID: "synthetic-not-used", HELLO_AGE_SECRET_KEY: "synthetic-not-used", HELLO_AGE_PROVIDER_APPROVED: "true", HELLO_AGE_PROVIDER_DISCLOSURE: "隔离合成核验，仅供测试，不代表真实供应商" });
  const begin = await challenge(service); assert.ok(begin.challenge);
  const other = new AgeService(payload, differentOwner, async () => { throw new Error("must not call"); });
  await assert.rejects(() => other.submit({ ...identity, challenge: begin.challenge }), /无效|过期/);
  const adult = await service.submit({ ...identity, challenge: begin.challenge }); assert.equal(adult.allowed, true);
  await assert.rejects(() => service.submit({ ...identity, challenge: begin.challenge }), /已使用|无效/);
  assert.equal((await new AgeService(payload, owner).status()).allowed, true);
  const recoveredCredential = await mintCredential(payload, "miniapp", owner.id);
  assert.equal((await new AgeService(payload, await authenticate(payload, nativeReq(recoveredCredential.token))).status()).allowed, false);
  console.log("✓ 未配置安全失败、服务端年龄绑定、严格字段、一次性请求、结果恢复、恢复码权限不升级");

  const privacy = new PrivacyService(new Repository(payload, owner));
  const consent = { version: privacyPolicy().version, core: true as const, model: true as const, sensitive: true, external: true, externalRecipient: { name: "合成外部客户端", contact: "test@example.invalid", region: "本地", privacyUrl: "https://example.invalid/privacy" } };
  await privacy.consent(consent);
  assert.equal((await http(linked.token, ["sessions"], { title: "通过后的合成会话" })).status, 200);
  assert.equal((await http(linked.token, ["token"], {})).status, 403);
  // 导入升级前的测试令牌，验证已有外部凭证也不能访问。
  const bearer = randomUUID();
  await payload.create({ collection: "credentials", overrideAccess: true, data: { owner: owner.id, kind: "bearer", digest: createHash("sha256").update(bearer).digest("hex"), wechatKey: owner.wechatKey, expiresAt: "2099-01-01T00:00:00.000Z" } });
  await assert.rejects(() => authenticate(payload, nativeReq(bearer), true), /仅开放平台/);
  const webCredential = await mintCredential(payload, "cookie", owner.id);
  const webBypass = await POST(new Request("http://127.0.0.1:3310/api/hello/upload", { method: "POST", headers: { Origin: "http://127.0.0.1:3310", Cookie: `${COOKIE}=${webCredential.token}`, "Content-Type": "application/json" }, body: "{}" }), { params: Promise.resolve({ path: ["upload"] }) });
  assert.equal(webBypass.status, 403, "H5恢复/访客Cookie不能继承微信成年权限");
  let browserExchange = false;
  await assert.rejects(() => wechatLogin(payload, new Request("http://localhost", { headers: { Origin: "http://127.0.0.1:3310" } }), creds, async () => { browserExchange = true; return "invalid"; }), /微信小程序/);
  assert.equal(browserExchange, false);
  await service.requireAdditionalVerification();
  await assert.rejects(() => new Repository(payload, owner).create("sessions", { title: "追加复核后的迟到写入" }), /年龄核验/);
  for (const endpoint of ["sessions", "upload", "greet", "ag-ui", "context/compact", "context/ad-start", "token"]) {
    assert.equal((await http(linked.token, endpoint.split("/"), {})).status, 403, endpoint);
  }
  assert.equal((await http(bearer, ["sessions"])).status, 403);
  assert.equal((await mcpPost(new Request("http://localhost/api/mcp", { method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: "{}" }))).status, 403);
  assert.equal((await http(linked.token, ["privacy"])).status, 200);
  assert.equal((await http(linked.token, ["sessions"])).status, 200);
  console.log("✓ REST/H5/外部令牌/MCP均拦截，已登录用户历史、隐私保留");

  for (const state of ["minor", "unknown", "failed", "unavailable"] as const) {
    const subject = await fresh(); let calls = 0;
    const instance = new AgeService(payload, subject.owner, async () => { calls++; return { state, reference: "synthetic" }; });
    const prepared = await challenge(instance);
    assert.equal((await instance.submit({ ...identity, challenge: prepared.challenge })).state, state === "minor" ? "needs_review" : state);
    await assert.rejects(() => instance.requireCapability(), /年龄/);
    if (state === "minor") { await instance.cancel(); assert.equal((await instance.status()).state, "needs_review"); await assert.rejects(() => challenge(instance), /复核/); }
    assert.equal(calls, 1);
  }
  const child = await fresh(); let childCalls = 0;
  const childService = new AgeService(payload, child.owner, async () => { childCalls++; return { state: "adult" }; });
  const childResult = await challenge(childService, "under14");
  assert.equal(childResult.challenge, null); assert.equal(childResult.status.allowed, false); assert.equal(childCalls, 0);
  const correct = (service: InstanceType<typeof AgeService>) => service.challenge({ declaration: "unknown", correction: true, consent: true, noticeVersion: ageNotice().version });
  await assert.rejects(() => challenge(childService, "adult"), /未成年|复核/);
  await assert.rejects(() => childService.challenge({ declaration: "adult", correction: true, consent: true, noticeVersion: ageNotice().version }), /身份证/);
  const cancelledCorrection = await correct(childService);
  assert.ok(cancelledCorrection.challenge); assert.equal(cancelledCorrection.status.allowed, false);
  assert.equal(cancelledCorrection.status.declaration, "under14");
  await childService.cancel();
  await assert.rejects(() => childService.submit({ ...identity, challenge: cancelledCorrection.challenge }), /无效|过期/);
  const failedCorrection = new AgeService(payload, child.owner, async () => ({ state: "failed" }));
  const failedChallenge = await correct(failedCorrection);
  const failedState = await failedCorrection.submit({ ...identity, challenge: failedChallenge.challenge });
  assert.equal(failedState.allowed, false); assert.equal(failedState.declaration, "under14");
  const correction = await correct(childService);
  const corrected = await childService.submit({ ...identity, challenge: correction.challenge });
  assert.equal(corrected.allowed, true); assert.equal(corrected.declaration, "adult");
  assert.equal(childCalls, 1);
  await assert.rejects(() => childService.submit({ ...identity, challenge: correction.challenge }), /无效|过期/);
  const teen = await fresh(); let teenCalls = 0;
  const teenService = new AgeService(payload, teen.owner, async () => { teenCalls++; return { state: "adult" }; });
  const teenDeclaration = await challenge(teenService, "14to17");
  assert.equal(teenDeclaration.status.allowed, false); assert.equal(teenCalls, 0);
  const teenCorrection = await correct(teenService);
  assert.equal(teenCorrection.status.declaration, "14to17"); assert.equal(teenCorrection.status.allowed, false);
  const correctedTeen = await teenService.submit({ ...identity, challenge: teenCorrection.challenge });
  assert.equal(correctedTeen.allowed, true); assert.equal(correctedTeen.declaration, "adult"); assert.equal(teenCalls, 1);
  const verifiedMinor = await fresh();
  const minorService = new AgeService(payload, verifiedMinor.owner, async () => ({ state: "minor", reference: "synthetic-minor" }));
  const minorChallenge = await challenge(minorService);
  await minorService.submit({ ...identity, challenge: minorChallenge.challenge });
  await assert.rejects(() => correct(minorService), /复核/);
  assert.equal((await minorService.status()).review?.state, "pending");
  assert.equal((await minorService.requestReview()).review?.state, "pending");
  const review = await fresh(); const reviewService = new AgeService(payload, review.owner);
  await challenge(reviewService, "under14"); await reviewService.requireAdditionalVerification();
  await assert.rejects(() => correct(reviewService), /复核/);
  console.log("✓ 误填生日只能由身份证核验更正，失败/取消不解除限制，已核验未成年和风险复核不能绕过");
  const conflict = await fresh(); let reviewProviderCalls = 0;
  const conflictService = new AgeService(payload, conflict.owner, async () => ++reviewProviderCalls === 1 ? ({ state: "adult", reference: "synthetic-initial" }) : reviewProviderCalls === 2 ? ({ state: "unavailable" }) : ({ state: "adult", reference: "synthetic-review" }));
  const conflicting = await challenge(conflictService, "14to17");
  assert.equal((await conflictService.submit({ ...identity, challenge: conflicting.challenge })).state, "needs_review");
  const ops = new OperationsService(payload);
  const administrator = { ...await payload.create({ collection: "admins", overrideAccess: true, context: { helloAdminBootstrap: true }, data: { role: "reviewer", email: "age-admin@example.invalid", password: "isolated-test-pass-123" } }), collection: "admins" as const };
  const reviewer = { ...await payload.create({ collection: "admins", overrideAccess: false, user: administrator, data: { role: "reviewer", email: "age-reviewer@example.invalid", password: "isolated-test-pass-123" } }), collection: "admins" as const };
  const secondAdministrator = { ...await payload.create({ collection: "admins", overrideAccess: false, user: administrator, data: { role: "administrator", email: "age-second-admin@example.invalid", password: "isolated-test-pass-123" } }), collection: "admins" as const };
  assert.equal(operationLabels.restore_age_access, "直接解除年龄限制");
  async function manualRestriction(verifier?: () => Promise<{ state: "adult"; reference: string }>) {
    const subject = await fresh();
    let providerCalls = 0;
    const instance = new AgeService(payload, subject.owner, verifier ?? (() => { providerCalls++; throw new Error("direct restore must not invoke a provider"); }));
    await instance.requireAdditionalVerification();
    const pending = await instance.requestReview();
    const row = (await ops.queue(administrator, {})).find((item) => item.receipt === pending.review?.receipt)!;
    return { subject, instance, row, providerCalls: () => providerCalls };
  }
  const unclaimed = await manualRestriction();
  await assert.rejects(() => ops.action(administrator, Number(unclaimed.row.id), { revision: 0, action: "restore_age_access", reason: "未领取不能直接恢复年龄能力", reply: "管理员已直接恢复年龄权限。" }), /领取|负责人|受理/);
  const nonAdministrator = await manualRestriction();
  await ops.action(reviewer, Number(nonAdministrator.row.id), { revision: 0, action: "claim", reason: "普通审核员领取以验证直接恢复权限" });
  await assert.rejects(() => ops.action(reviewer, Number(nonAdministrator.row.id), { revision: 1, action: "restore_age_access", reason: "普通审核员不能直接恢复年龄能力", reply: "管理员已直接恢复年龄权限。" }), /系统管理员/);
  const missingReason = await manualRestriction();
  await ops.action(administrator, Number(missingReason.row.id), { revision: 0, action: "claim", reason: "管理员领取缺失理由回归案件" });
  await assert.rejects(() => ops.action(administrator, Number(missingReason.row.id), { revision: 1, action: "restore_age_access", reply: "缺少人工核实理由。" }));
  const missingReply = await manualRestriction();
  await ops.action(administrator, Number(missingReply.row.id), { revision: 0, action: "claim", reason: "管理员领取缺失回复回归案件" });
  await assert.rejects(() => ops.action(administrator, Number(missingReply.row.id), { revision: 1, action: "restore_age_access", reason: "合成人工材料足以直接恢复年龄能力" }), /说明/);
  const stale = await manualRestriction();
  await ops.action(administrator, Number(stale.row.id), { revision: 0, action: "claim", reason: "管理员领取旧修订号回归案件" });
  await ops.action(administrator, Number(stale.row.id), { revision: 1, action: "review", reason: "制造修订号变化后验证直接恢复" });
  await assert.rejects(() => ops.action(administrator, Number(stale.row.id), { revision: 1, action: "restore_age_access", reason: "旧修订号不能直接恢复年龄能力", reply: "管理员已直接恢复年龄权限。" }), /刷新/);
  const wrongCycle = await manualRestriction();
  await ops.action(administrator, Number(wrongCycle.row.id), { revision: 0, action: "claim", reason: "管理员领取周期绑定回归案件" });
  const wrongCycleProfile = await ageProfile(payload, wrongCycle.subject.owner.id);
  await payload.update({ collection: "age-profiles", id: wrongCycleProfile!.id, overrideAccess: true, data: { reference: `age-review:${Number(wrongCycle.row.id) + 100}` } });
  await assert.rejects(() => ops.action(administrator, Number(wrongCycle.row.id), { revision: 1, action: "restore_age_access", reason: "旧周期不能直接恢复当前年龄能力", reply: "管理员已直接恢复年龄权限。" }), /当前限制周期/);

  const directlyRestored = await manualRestriction();
  const beforeRestore = await ageProfile(payload, directlyRestored.subject.owner.id);
  await ops.action(administrator, Number(directlyRestored.row.id), { revision: 0, action: "claim", reason: "管理员领取直接恢复合成年龄案件" });
  await ops.action(administrator, Number(directlyRestored.row.id), { revision: 1, action: "restore_age_access", reason: "合成线下材料已由管理员人工核实为成年", reply: "管理员已直接恢复年龄权限，不需要再次提交身份核验表单。" });
  const restoredStatus = await directlyRestored.instance.status();
  assert.equal(restoredStatus.state, "adult"); assert.equal(restoredStatus.allowed, true);
  assert.equal(restoredStatus.assurance, null);
  assert.equal(restoredStatus.source, "administrator_age_review_manual_assurance");
  assert.equal(restoredStatus.review?.state, "completed"); assert.equal(restoredStatus.review?.result, null);
  assert.equal(restoredStatus.review?.manualDecision, true);
  assert.equal(restoredStatus.actions?.startReverification, false); assert.equal(directlyRestored.providerCalls(), 0);
  const restoredProfile = await ageProfile(payload, directlyRestored.subject.owner.id);
  assert.equal(restoredProfile?.challenge, null); assert.equal(restoredProfile?.challengePurpose, null);
  assert.equal(restoredProfile?.assurance, "manual_administrator_assurance");
  assert.equal(restoredProfile?.source, "administrator_age_review_manual_assurance");
  assert.equal(restoredProfile?.reference, `age-review:${directlyRestored.row.id}:1`);
  assert.equal(restoredProfile?.consentedAt, beforeRestore?.consentedAt);
  assert.ok(restoredProfile?.expiresAt);
  const expectedExpiry = Date.parse(restoredProfile.verifiedAt || new Date().toISOString()) + 30 * 86400_000;
  assert.ok(Math.abs(Date.parse(restoredProfile.expiresAt) - expectedExpiry) < 5_000);
  await directlyRestored.instance.requireCapability();
  const capabilitySession = await payload.create({ collection: "sessions", overrideAccess: true, data: { owner: directlyRestored.subject.owner.id, title: "合成直接恢复会话" } });
  await payload.create({ collection: "greetings", overrideAccess: true, data: { owner: directlyRestored.subject.owner.id, sessionId: capabilitySession.id, requestKey: randomUUID(), fingerprint: "synthetic-manual-age-write", mode: "platform", status: "completed", input: { text: "合成直接恢复后的实际写入", mediaIds: [] }, greeting: "合成回复", artifacts: [] } });
  await payload.create({ collection: "media", overrideAccess: true, data: { owner: directlyRestored.subject.owner.id, mimeType: "image/png", base64: "c3ludGhldGlj" } });
  const manualAudit = (await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: { and: [{ event: { equals: "case.restore_age_access" } }, { target: { equals: `case:${directlyRestored.row.id}` } }] } })).docs[0];
  const manualAuditMetadata = manualAudit?.metadata as Record<string, unknown> | undefined;
  assert.equal(manualAuditMetadata?.assurance, "manual_administrator_assurance");
  assert.equal(manualAuditMetadata?.source, "administrator_age_review_manual_assurance");
  assert.equal(manualAuditMetadata?.providerInvoked, false);
  const { assertGenerationAllowed } = await import("../src/operations/enforcement");
  const restrictionCase = await payload.create({ collection: "safety-cases", overrideAccess: true, context: { safetyInternal: true }, data: { owner: directlyRestored.subject.owner.id, receipt: randomUUID(), source: "moderation", status: "resolved", severity: "normal", category: "other", stage: "synthetic_content_restriction", revision: 0, action: "restrict", reason: "合成验证内容限制与年龄限制互相独立" } });
  await payload.create({ collection: "safety-enforcements", overrideAccess: true, context: { safetyInternal: true }, data: { key: `owner:${directlyRestored.subject.owner.id}:${restrictionCase.id}`, owner: directlyRestored.subject.owner.id, targetType: "owner", caseId: restrictionCase.id, active: true, reason: "合成内容限制" } });
  await assert.rejects(() => assertGenerationAllowed(payload, directlyRestored.subject.owner.id), /生成权限/);
  await assert.rejects(() => payload.create({ collection: "greetings", overrideAccess: true, data: { owner: directlyRestored.subject.owner.id, sessionId: capabilitySession.id, requestKey: randomUUID(), fingerprint: "synthetic-manual-age-content-block", mode: "platform", status: "completed", input: { text: "内容限制仍应独立生效", mediaIds: [] }, greeting: "不应发布", artifacts: [] } }), /内容或身份已受限/);
  console.log("✓ 管理员直接恢复使用人工来源、30天有效期、真实写入门禁，且不解除内容限制");

  const lifecycleSubject = await fresh(); let lifecycleProviderCalls = 0;
  const lifecycleService = new AgeService(payload, lifecycleSubject.owner, () => { lifecycleProviderCalls++; throw new Error("manual lifecycle renewal must not invoke provider"); });
  await challenge(lifecycleService, "under14");
  await lifecycleService.requireAdditionalVerification();
  const lifecyclePending = await lifecycleService.requestReview();
  const lifecycleRow = (await ops.queue(administrator, {})).find((row) => row.receipt === lifecyclePending.review?.receipt)!;
  await ops.action(administrator, Number(lifecycleRow.id), { revision: 0, action: "claim", reason: "管理员领取人工生命周期回归案件" });
  await ops.action(administrator, Number(lifecycleRow.id), { revision: 1, action: "restore_age_access", reason: "合成线下材料确认成年但保留原未成年申报", reply: "管理员已直接恢复年龄权限。" });
  const lifecycleRestored = await lifecycleService.status();
  assert.equal(lifecycleRestored.allowed, true); assert.equal(lifecycleRestored.declaration, "under14");
  assert.equal(lifecycleRestored.assurance, null); assert.equal(lifecycleRestored.review?.manualDecision, true);
  const lifecycleProfile = await ageProfile(payload, lifecycleSubject.owner.id);
  await payload.update({ collection: "age-profiles", id: lifecycleProfile!.id, overrideAccess: true, data: { expiresAt: new Date(Date.now() - 1_000).toISOString() } });
  const lifecycleExpired = await lifecycleService.status();
  assert.equal(lifecycleExpired.state, "expired"); assert.equal(lifecycleExpired.allowed, false);
  assert.equal(lifecycleExpired.declaration, "under14"); assert.equal(lifecycleExpired.assurance, null);
  assert.equal(lifecycleExpired.review?.state, "request_required"); assert.equal(lifecycleExpired.review?.result, null);
  assert.equal(lifecycleExpired.review?.manualDecision, true); assert.equal(lifecycleExpired.actions?.requestReview, true);
  assert.equal(lifecycleExpired.actions?.startReverification, false);
  const lifecycleRenewal = await lifecycleService.requestReview();
  assert.equal(lifecycleRenewal.allowed, false); assert.equal(lifecycleRenewal.state, "needs_review");
  assert.equal(lifecycleRenewal.declaration, "under14"); assert.notEqual(lifecycleRenewal.review?.receipt, lifecycleRow.receipt);
  const lifecycleRenewalProfile = await ageProfile(payload, lifecycleSubject.owner.id);
  assert.equal(lifecycleRenewalProfile?.assurance, null); assert.ok(!lifecycleRenewalProfile?.expiresAt);
  const lifecycleRenewalRow = (await ops.queue(administrator, {})).find((row) => row.receipt === lifecycleRenewal.review?.receipt)!;
  assert.equal(lifecycleRenewalRow.parentId, null);
  await assertProvenance(lifecycleRenewal.review!.receipt!, { source: "complaint", actor: `owner:${lifecycleSubject.owner.id}`, reason: "本人申请年龄复核", evidence: "本人申请年龄限制复核。" });
  await ops.action(administrator, Number(lifecycleRenewalRow.id), { revision: 0, action: "claim", reason: "原管理员领取日期到期人工续期复核案件" });
  await ops.action(administrator, Number(lifecycleRenewalRow.id), { revision: 1, action: "restore_age_access", reason: "合成日期到期续期材料仍确认成年且需重新审核", reply: "人工续期复核已重新通过。" });
  const lifecycleRenewed = await lifecycleService.status();
  assert.equal(lifecycleRenewed.allowed, true); assert.equal(lifecycleRenewed.declaration, "under14");
  assert.equal(lifecycleRenewed.review?.state, "completed"); assert.notEqual(lifecycleRenewed.review?.receipt, lifecycleRow.receipt);
  const lifecycleRenewedCase = await payload.findByID({ collection: "safety-cases", id: Number(lifecycleRenewalRow.id), overrideAccess: true });
  assert.equal(lifecycleRenewedCase.assignedTo, administrator.id); assert.equal(lifecycleRenewedCase.revision, 2);
  assert.equal(lifecycleRenewedCase.reason, "合成日期到期续期材料仍确认成年且需重新审核");
  assert.equal(lifecycleRenewedCase.reply, "人工续期复核已重新通过。");
  assert.ok((await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: { and: [
    { event: { equals: "case.restore_age_access" } }, { target: { equals: `case:${lifecycleRenewalRow.id}` } },
  ] } })).docs[0]);
  await payload.update({ collection: "age-profiles", id: lifecycleRenewalProfile!.id, overrideAccess: true, data: { noticeVersion: "age-v1.outdated-notice" } });
  const lifecycleNoticeExpired = await lifecycleService.status();
  assert.equal(lifecycleNoticeExpired.state, "expired"); assert.equal(lifecycleNoticeExpired.allowed, false);
  assert.equal(lifecycleNoticeExpired.review?.state, "request_required"); assert.equal(lifecycleNoticeExpired.actions?.requestReview, true);
  const lifecycleNoticeRenewal = await lifecycleService.requestReview();
  assert.equal(lifecycleNoticeRenewal.allowed, false); assert.equal(lifecycleNoticeRenewal.state, "needs_review");
  assert.notEqual(lifecycleNoticeRenewal.review?.receipt, lifecycleRenewal.review?.receipt);
  const lifecycleNoticeRenewalRow = (await ops.queue(administrator, {})).find((row) => row.receipt === lifecycleNoticeRenewal.review?.receipt)!;
  assert.equal(lifecycleNoticeRenewalRow.parentId, null);
  await assertProvenance(lifecycleNoticeRenewal.review!.receipt!, { source: "complaint", actor: `owner:${lifecycleSubject.owner.id}`, reason: "本人申请年龄复核", evidence: "本人申请年龄限制复核。" });
  await ops.action(administrator, Number(lifecycleNoticeRenewalRow.id), { revision: 0, action: "claim", reason: "原管理员领取说明版本到期人工续期复核案件" });
  await ops.action(administrator, Number(lifecycleNoticeRenewalRow.id), { revision: 1, action: "restore_age_access", reason: "合成说明版本到期续期材料仍确认成年且需重新审核", reply: "说明版本更新后的人工续期复核已重新通过。" });
  const lifecycleNoticeRenewed = await lifecycleService.status();
  assert.equal(lifecycleNoticeRenewed.allowed, true); assert.equal(lifecycleNoticeRenewed.state, "adult");
  assert.equal(lifecycleNoticeRenewed.declaration, "under14");
  assert.equal(lifecycleNoticeRenewed.review?.receipt, lifecycleNoticeRenewal.review?.receipt);
  const lifecycleNoticeRenewedCase = await payload.findByID({ collection: "safety-cases", id: Number(lifecycleNoticeRenewalRow.id), overrideAccess: true });
  assert.equal(lifecycleNoticeRenewedCase.assignedTo, administrator.id); assert.equal(lifecycleNoticeRenewedCase.revision, 2);
  assert.equal(lifecycleNoticeRenewedCase.reason, "合成说明版本到期续期材料仍确认成年且需重新审核");
  assert.equal(lifecycleNoticeRenewedCase.reply, "说明版本更新后的人工续期复核已重新通过。");
  assert.ok((await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: { and: [
    { event: { equals: "case.restore_age_access" } }, { target: { equals: `case:${lifecycleNoticeRenewalRow.id}` } },
  ] } })).docs[0]);
  assert.equal(lifecycleProviderCalls, 0);
  console.log("✓ 人工直接恢复日期或说明到期后创建普通续期案件，同一管理员可重新领取、审批并审计");

  const staleFormRace = await manualRestriction();
  await ops.action(administrator, Number(staleFormRace.row.id), { revision: 0, action: "claim", reason: "管理员领取待处理表单竞争案件" });
  const newRisk = await staleFormRace.instance.requireAdditionalVerification();
  const currentRiskReceipt = newRisk.review?.receipt;
  assert.ok(currentRiskReceipt);
  assert.notEqual(currentRiskReceipt, staleFormRace.row.receipt);
  await assert.rejects(() => ops.action(administrator, Number(staleFormRace.row.id), { revision: 1, action: "restore_age_access", reason: "旧修订号不能覆盖新登记的年龄风险", reply: "管理员不能使用旧表单恢复权限。" }), /更新周期|刷新/);
  const restrictedAfterNewRisk = await staleFormRace.instance.status();
  assert.equal(restrictedAfterNewRisk.allowed, false); assert.equal(restrictedAfterNewRisk.review?.state, "pending");
  const deduplicatedRisk = await staleFormRace.instance.requestReview();
  assert.equal(deduplicatedRisk.review?.receipt, currentRiskReceipt);
  const currentRiskRow = (await ops.queue(administrator, {})).find((row) => row.receipt === currentRiskReceipt)!;
  await ops.action(secondAdministrator, Number(currentRiskRow.id), { revision: 0, action: "claim", reason: "另一管理员领取新风险当前案件" });
  await ops.action(secondAdministrator, Number(currentRiskRow.id), { revision: 1, action: "restore_age_access", reason: "新风险当前案件可由管理员人工核实后恢复", reply: "当前案件的人工核实结果已生效。" });
  assert.equal((await staleFormRace.instance.status()).allowed, true);
  console.log("✓ 新风险使旧表单修订失效；安全去重复用当前案件，当前案件仍可人工决定");

  const permitCycle = await manualRestriction();
  await ops.action(administrator, Number(permitCycle.row.id), { revision: 0, action: "claim", reason: "管理员领取旧未结案件以验证最新周期" });
  const permitCycleRisk = await permitCycle.instance.requireAdditionalVerification();
  assert.ok(permitCycleRisk.review?.receipt);
  const permitCycleRiskReceipt = permitCycleRisk.review.receipt;
  assert.notEqual(permitCycleRiskReceipt, permitCycle.row.receipt);
  const permitCycleRiskRow = (await ops.queue(administrator, {})).find((row) => row.receipt === permitCycleRiskReceipt)!;
  await ops.action(administrator, Number(permitCycleRiskRow.id), { revision: 0, action: "claim", reason: "管理员领取最新准许核验周期" });
  await ops.action(administrator, Number(permitCycleRiskRow.id), { revision: 1, action: "permit_age_reverification", reason: "最新周期允许重新本人核验", reply: "可以重新发起本人年龄核验。" });
  const permitCycleStatus = await permitCycle.instance.status();
  assert.equal(permitCycleStatus.review?.state, "approved"); assert.equal(permitCycleStatus.review?.receipt, permitCycleRiskReceipt);
  assert.equal((await permitCycle.instance.requestReview()).review?.receipt, permitCycleRiskReceipt);
  const permitCycleProfile = await ageProfile(payload, permitCycle.subject.owner.id);
  assert.equal(String(permitCycleProfile?.reference).startsWith(`age-review:${permitCycleRiskRow.id}`), true);
  assert.equal(String(permitCycleProfile?.reference).startsWith(`age-review:${permitCycle.row.id}`), false);
  assert.equal((await payload.findByID({ collection: "safety-cases", id: Number(permitCycle.row.id), overrideAccess: true })).status, "in_progress");
  console.log("✓ 最新周期准许后重复申请仍复用当前批准，不改绑旧未结案件");

  const maintainCycle = await manualRestriction();
  await ops.action(administrator, Number(maintainCycle.row.id), { revision: 0, action: "claim", reason: "管理员领取旧未结案件以验证维持后申诉" });
  const maintainCycleRisk = await maintainCycle.instance.requireAdditionalVerification();
  assert.ok(maintainCycleRisk.review?.receipt);
  const maintainCycleRiskReceipt = maintainCycleRisk.review.receipt;
  const maintainCycleRiskRow = (await ops.queue(administrator, {})).find((row) => row.receipt === maintainCycleRiskReceipt)!;
  await ops.action(administrator, Number(maintainCycleRiskRow.id), { revision: 0, action: "claim", reason: "管理员领取最新维持限制周期" });
  await ops.action(administrator, Number(maintainCycleRiskRow.id), { revision: 1, action: "maintain_age_restriction", reason: "最新周期继续维持年龄限制", reply: "继续维持限制。" });
  const maintainCycleAppeal = await maintainCycle.instance.requestReview();
  assert.equal(maintainCycleAppeal.review?.state, "pending");
  assert.equal(maintainCycleAppeal.review?.caseStatus, "review");
  assert.notEqual(maintainCycleAppeal.review?.receipt, maintainCycleRiskReceipt);
  assert.notEqual(maintainCycleAppeal.review?.receipt, maintainCycle.row.receipt);
  const maintainAppealRow = (await ops.queue(administrator, {})).find((row) => row.receipt === maintainCycleAppeal.review?.receipt)!;
  assert.equal(Number(maintainAppealRow.parentId), Number(maintainCycleRiskRow.id));
  const maintainCycleProfile = await ageProfile(payload, maintainCycle.subject.owner.id);
  assert.equal(String(maintainCycleProfile?.reference).startsWith(`age-review:${maintainAppealRow.id}`), true);
  assert.equal(String(maintainCycleProfile?.reference).startsWith(`age-review:${maintainCycle.row.id}`), false);
  console.log("✓ 最新周期维持后申请生成独立申诉父案，不改绑旧未结案件");

  const atomic = await manualRestriction();
  await ops.action(administrator, Number(atomic.row.id), { revision: 0, action: "claim", reason: "管理员领取原子审计回归案件" });
  await payload.db.drizzle.run(sql`CREATE TRIGGER block_manual_restore_audit BEFORE INSERT ON safety_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit blocked'); END`);
  try { await assert.rejects(() => ops.action(administrator, Number(atomic.row.id), { revision: 1, action: "restore_age_access", reason: "审计失败时必须整体回滚", reply: "这条结果不应可见。" })); }
  finally { await payload.db.drizzle.run(sql`DROP TRIGGER block_manual_restore_audit`); }
  const atomicProfile = await ageProfile(payload, atomic.subject.owner.id);
  const atomicCase = (await payload.findByID({ collection: "safety-cases", id: Number(atomic.row.id), overrideAccess: true }));
  assert.equal(atomicProfile?.state, "needs_review"); assert.equal(atomicProfile?.additionalVerification, "required");
  assert.equal(atomicCase.status, "in_progress"); assert.equal(atomicCase.action, null); assert.equal(atomicCase.revision, 1);
  assert.equal((await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 1, where: { and: [{ event: { equals: "case.restore_age_access" } }, { target: { equals: `case:${atomic.row.id}` } }] } })).docs.length, 0);
  console.log("✓ 直接恢复的案件、年龄状态与审计在同一事务内提交或回滚");

  const protectedSubject = await manualRestriction();
  await ops.action(administrator, Number(protectedSubject.row.id), { revision: 0, action: "claim", reason: "管理员领取隐私保护回归案件" });
  const protectedPrivacy = (await payload.find({ collection: "privacy-profiles", overrideAccess: true, limit: 1, where: { owner: { equals: protectedSubject.subject.owner.id } } })).docs[0];
  if (protectedPrivacy) await payload.update({ collection: "privacy-profiles", id: protectedPrivacy.id, overrideAccess: true, data: { state: "withdrawn" } });
  else await payload.create({ collection: "privacy-profiles", overrideAccess: true, data: { owner: protectedSubject.subject.owner.id, state: "withdrawn", revision: 0 } });
  await assert.rejects(() => ops.action(administrator, Number(protectedSubject.row.id), { revision: 1, action: "restore_age_access", reason: "隐私停止处理时不能直接恢复", reply: "管理员不能直接恢复年龄权限。" }), /停止处理/);
  const unbound = await manualRestriction();
  await ops.action(administrator, Number(unbound.row.id), { revision: 0, action: "claim", reason: "管理员领取微信绑定回归案件" });
  await payload.delete({ collection: "wechat-identities", overrideAccess: true, where: { owner: { equals: unbound.subject.owner.id } } });
  await assert.rejects(() => ops.action(administrator, Number(unbound.row.id), { revision: 1, action: "restore_age_access", reason: "缺少微信绑定时不能直接恢复", reply: "管理员不能直接恢复年龄权限。" }), /微信绑定/);
  console.log("✓ 直接恢复保留隐私状态与微信绑定检查");

  let outstandingCalls = 0; let finishOutstanding!: (value: { state: "adult"; reference: string }) => void; let outstandingStarted!: () => void;
  const outstandingEntered = new Promise<void>((resolve) => { outstandingStarted = resolve; });
  const outstandingEvidence = new Promise<{ state: "adult"; reference: string }>((resolve) => { finishOutstanding = resolve; });
  const outstanding = await manualRestriction(async () => { outstandingCalls++; outstandingStarted(); return outstandingEvidence; });
  await ops.action(administrator, Number(outstanding.row.id), { revision: 0, action: "claim", reason: "管理员领取晚到供应商结果回归案件" });
  await ops.action(administrator, Number(outstanding.row.id), { revision: 1, action: "permit_age_reverification", reason: "先批准本人核验以准备晚到结果回归", reply: "可以重新发起本人年龄核验。" });
  const outstandingReviewChallenge = await outstanding.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  const outstandingSubmit = outstanding.instance.submit({ ...identity, challenge: outstandingReviewChallenge.challenge });
  await outstandingEntered;
  await assert.rejects(async () => {
    try {
      await ops.action(administrator, Number(outstanding.row.id), { revision: 2, action: "review", reason: "供应商等待期间重新打开年龄案件" });
      await ops.action(secondAdministrator, Number(outstanding.row.id), { revision: 3, action: "claim", reason: "另一管理员处理等待中的年龄案件" });
      await ops.action(secondAdministrator, Number(outstanding.row.id), { revision: 4, action: "restore_age_access", reason: "人工决定后晚到结果不能覆盖", reply: "管理员已直接恢复年龄权限。" });
    } finally {
      finishOutstanding({ state: "adult", reference: "synthetic-late-provider" });
    }
    return outstandingSubmit;
  }, /状态已变更/);
  const afterOutstanding = await outstanding.instance.status();
  assert.equal(afterOutstanding.allowed, true); assert.equal(afterOutstanding.assurance, null); assert.equal(afterOutstanding.source, "administrator_age_review_manual_assurance");
  assert.equal(afterOutstanding.review?.result, null); assert.equal(afterOutstanding.review?.manualDecision, true); assert.equal(outstandingCalls, 1);
  console.log("✓ 直接恢复作废挑战，晚到成年供应商结果不能覆盖人工决定");

  let beforePendingCalls = 0;
  const beforePending = await manualRestriction(async () => { beforePendingCalls++; return { state: "adult", reference: "synthetic-before-pending" }; });
  await ops.action(administrator, Number(beforePending.row.id), { revision: 0, action: "claim", reason: "管理员领取待写入竞争回归案件" });
  await ops.action(administrator, Number(beforePending.row.id), { revision: 1, action: "permit_age_reverification", reason: "先批准本人核验以验证待写入竞争", reply: "可以重新发起本人年龄核验。" });
  const beforePendingChallenge = await beforePending.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  const originalFind = beforePending.instance.payload.find.bind(payload);
  const mutablePayload = payload as unknown as { find: typeof payload.find };
  let interceptBeforePending = true;
  try {
    mutablePayload.find = async (options) => {
      const result = await originalFind(options);
      if (interceptBeforePending && options.collection === "safety-cases") {
        interceptBeforePending = false;
        await ops.action(administrator, Number(beforePending.row.id), { revision: 2, action: "review", reason: "提交者读取旧批准后管理员重新打开案件" });
        await ops.action(secondAdministrator, Number(beforePending.row.id), { revision: 3, action: "claim", reason: "另一管理员处理待写入竞争" });
        await ops.action(secondAdministrator, Number(beforePending.row.id), { revision: 4, action: "restore_age_access", reason: "待写入前管理员已直接恢复年龄能力", reply: "管理员已直接恢复年龄权限。" });
      }
      return result;
    };
    await assert.rejects(() => beforePending.instance.submit({ ...identity, challenge: beforePendingChallenge.challenge }), /状态已变更|复核批准已变更/);
  } finally {
    mutablePayload.find = originalFind;
  }
  const beforePendingStatus = await beforePending.instance.status();
  assert.equal(beforePendingStatus.allowed, true); assert.equal(beforePendingStatus.assurance, null);
  assert.equal(beforePendingStatus.source, "administrator_age_review_manual_assurance");
  assert.equal(beforePendingStatus.review?.manualDecision, true);
  assert.equal(beforePendingCalls, 0);
  console.log("✓ 管理员在待写入前提交人工决定时，挑战和尝试不会被旧读取覆盖，也不调用供应商");

  const nextConflict = await manualRestriction();
  await ops.action(administrator, Number(nextConflict.row.id), { revision: 0, action: "claim", reason: "管理员领取新冲突周期回归案件" });
  await ops.action(administrator, Number(nextConflict.row.id), { revision: 1, action: "restore_age_access", reason: "先恢复以验证新的未成年申报", reply: "管理员已直接恢复年龄权限。" });
  const nextConflictResult = await challenge(nextConflict.instance, "under14");
  assert.equal(nextConflictResult.status.allowed, false); assert.equal(nextConflictResult.status.state, "needs_review"); assert.equal(nextConflictResult.status.additionalVerification, "required");
  assert.equal(nextConflictResult.status.review?.state, "pending"); assert.notEqual(nextConflictResult.status.review?.receipt, nextConflict.row.receipt);
  assert.equal(nextConflict.providerCalls(), 0);
  const nextRisk = await manualRestriction();
  await ops.action(administrator, Number(nextRisk.row.id), { revision: 0, action: "claim", reason: "管理员领取新风险周期回归案件" });
  await ops.action(administrator, Number(nextRisk.row.id), { revision: 1, action: "restore_age_access", reason: "先恢复以验证新风险立即失效", reply: "管理员已直接恢复年龄权限。" });
  const nextRiskResult = await nextRisk.instance.requireAdditionalVerification();
  assert.equal(nextRiskResult.allowed, false); assert.notEqual(nextRiskResult.review?.receipt, nextRisk.row.receipt);
  assert.equal(nextRiskResult.review?.state, "pending");
  console.log("✓ 新的未成年申报或风险创建新的受限周期，不重复使用直接恢复授权");

  const genericCase = await payload.create({ collection: "safety-cases", overrideAccess: true, context: { safetyInternal: true }, data: { owner: directlyRestored.subject.owner.id, receipt: randomUUID(), source: "moderation", status: "in_progress", severity: "normal", category: "other", stage: "user_report", revision: 0, assignedTo: Number(administrator.id), modelVersion: "synthetic" } });
  await assert.rejects(() => ops.action(administrator, Number(genericCase.id), { revision: 0, action: "restore_age_access", reason: "年龄专用动作不能用于普通案件", reply: "不应允许。" }), /仅适用于年龄复核案件/);
  console.log("✓ 直接恢复是年龄案件专用动作，不改变通用解除生成限制语义");

  const requested = await conflictService.requestReview();
  assert.equal(requested.review?.state, "pending");
  assert.equal(requested.allowed, false);
  await assertProvenance(requested.review!.receipt!, { source: "moderation", actor: "system:age-verification", reason: "年龄申报与核验结果冲突", evidence: "本人申报与新的身份核验结果冲突。" });
  const duplicate = await conflictService.requestReview();
  assert.equal(duplicate.review?.receipt, requested.review?.receipt);
  const reviewRow = (await ops.queue(administrator, {})).find((row) => row.receipt === requested.review?.receipt)!;
  await assert.rejects(() => ops.action(reviewer, Number(reviewRow.id), { revision: 0, action: "maintain_age_restriction", reason: "未领取审核员不能作出年龄复核结论", reply: "继续维持年龄限制。" }), { status: 403 });
  await ops.action(reviewer, Number(reviewRow.id), { revision: 0, action: "claim", reason: "领取合成年龄复核案件进行权限验证" });
  await assert.rejects(() => ops.action(reviewer, Number(reviewRow.id), { revision: 1, action: "permit_age_reverification", reason: "普通审核员不能批准新的本人核验", reply: "允许重新核验。" }), { status: 403 });
  await ops.action(administrator, Number(reviewRow.id), { revision: 1, action: "claim", reason: "系统管理员领取并复核合成年龄案件" });
  await ops.action(administrator, Number(reviewRow.id), { revision: 2, action: "permit_age_reverification", reason: "合成记录符合重新本人核验条件", reply: "可以重新发起一次本人年龄核验；通过前仍保持限制。" });
  const approved = await conflictService.status();
  assert.equal(approved.review?.state, "approved"); assert.equal(approved.allowed, false); assert.equal(approved.actions?.startReverification, true);
  await assert.rejects(() => challenge(conflictService), /复核/);
  const freshEvidence = await conflictService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  assert.ok(freshEvidence.challenge);
  const unavailable = await conflictService.submit({ ...identity, challenge: freshEvidence.challenge });
  assert.equal(unavailable.allowed, false); assert.equal(unavailable.review?.state, "approved");
  await assert.rejects(() => conflictService.submit({ ...identity, challenge: freshEvidence.challenge }), /无效|过期/);
  const retryEvidence = await conflictService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  const unlocked = await conflictService.submit({ ...identity, challenge: retryEvidence.challenge });
  assert.equal(unlocked.allowed, true); assert.equal(unlocked.review?.state, "completed");
  await assert.rejects(() => conflictService.submit({ ...identity, challenge: retryEvidence.challenge }), /无效|过期/);

  async function completedApproval(verifier: () => Promise<{ state: "adult" | "minor"; reference: string; ageBand?: "under14" | "14to17" }>) {
    const subject = await fresh();
    const instance = new AgeService(payload, subject.owner, verifier);
    await instance.requireAdditionalVerification();
    const pending = await instance.requestReview();
    const row = (await ops.queue(administrator, {})).find((item) => item.receipt === pending.review?.receipt)!;
    await ops.action(administrator, Number(row.id), { revision: 0, action: "claim", reason: "管理员领取限制周期隔离回归案件" });
    await ops.action(administrator, Number(row.id), { revision: 1, action: "permit_age_reverification", reason: "允许合成用户提供新的本人年龄证据", reply: "可以重新发起本人年龄核验。" });
    const approvedChallenge = await instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
    assert.equal((await instance.submit({ ...identity, challenge: approvedChallenge.challenge })).allowed, true);
    return { subject, instance, receipt: pending.review!.receipt! };
  }

  let conflictCycleCalls = 0;
  const completedConflict = await completedApproval(async () => ({ state: "adult", reference: `synthetic-cycle-adult-${++conflictCycleCalls}` }));
  const newTeenChallenge = await challenge(completedConflict.instance, "14to17");
  const newTeenConflict = await completedConflict.instance.submit({ ...identity, challenge: newTeenChallenge.challenge });
  assert.equal(newTeenConflict.review?.state, "pending"); assert.notEqual(newTeenConflict.review?.receipt, completedConflict.receipt);
  assert.equal(newTeenConflict.additionalVerification, "required"); assert.equal(newTeenConflict.allowed, false);
  await assert.rejects(() => completedConflict.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /批准/);
  assert.equal((await completedConflict.instance.requestReview()).review?.receipt, newTeenConflict.review?.receipt);

  let minorCycleCalls = 0;
  const completedMinor = await completedApproval(async () => ++minorCycleCalls === 1
    ? { state: "adult", reference: "synthetic-cycle-adult" }
    : { state: "minor", reference: "synthetic-cycle-minor", ageBand: "14to17" });
  const newMinorChallenge = await challenge(completedMinor.instance, "14to17");
  const newMinor = await completedMinor.instance.submit({ ...identity, challenge: newMinorChallenge.challenge });
  assert.equal(newMinor.review?.state, "pending"); assert.notEqual(newMinor.review?.receipt, completedMinor.receipt);
  assert.equal(newMinor.additionalVerification, "required"); assert.equal(newMinor.allowed, false);
  await assert.rejects(() => completedMinor.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /批准/);

  const completedUnder14 = await completedApproval(async () => ({ state: "adult", reference: "synthetic-under14-cycle-adult" }));
  const newUnder14 = await challenge(completedUnder14.instance, "under14");
  assert.equal(newUnder14.challenge, null); assert.equal(newUnder14.status.review?.state, "pending");
  assert.notEqual(newUnder14.status.review?.receipt, completedUnder14.receipt); assert.equal(newUnder14.status.additionalVerification, "required");
  await assert.rejects(() => completedUnder14.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /批准/);

  const legacy = await completedApproval(async () => ({ state: "adult", reference: "synthetic-legacy-adult" }));
  const legacyProfile = await ageProfile(payload, legacy.subject.owner.id);
  await payload.update({ collection: "age-profiles", id: legacyProfile!.id, overrideAccess: true, data: {
    state: "needs_review", additionalVerification: "required", reference: "synthetic-stale-provider-reference", assurance: null, expiresAt: null,
  } });
  assert.equal((await legacy.instance.status()).review?.state, "request_required");
  const recoveredLegacy = await legacy.instance.requestReview();
  assert.equal(recoveredLegacy.review?.state, "pending"); assert.notEqual(recoveredLegacy.review?.receipt, legacy.receipt);
  await assert.rejects(() => legacy.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /批准/);

  let cancellationCalls = 0;
  const cancellation = await completedApproval(async () => { cancellationCalls++; return { state: "adult", reference: `synthetic-cancel-adult-${cancellationCalls}` }; });
  await cancellation.instance.requireAdditionalVerification();
  const cancellationPending = await cancellation.instance.requestReview();
  const cancellationRow = (await ops.queue(administrator, {})).find((item) => item.receipt === cancellationPending.review?.receipt)!;
  await ops.action(administrator, Number(cancellationRow.id), { revision: 0, action: "claim", reason: "管理员领取取消复核请求回归案件" });
  await ops.action(administrator, Number(cancellationRow.id), { revision: 1, action: "permit_age_reverification", reason: "允许合成用户重新提供年龄证据", reply: "可以重新发起本人年龄核验。" });
  const cancelledChallenge = await cancellation.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  const callsBeforeCancelledSubmit = cancellationCalls;
  await cancellation.instance.cancel();
  await assert.rejects(() => cancellation.instance.submit({ ...identity, challenge: cancelledChallenge.challenge }), /无效|过期/);
  assert.equal(cancellationCalls, callsBeforeCancelledSubmit);
  const replacementChallenge = await cancellation.instance.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  assert.notEqual(replacementChallenge.challenge, cancelledChallenge.challenge);
  const cancellationUnlocked = await cancellation.instance.submit({ ...identity, challenge: replacementChallenge.challenge });
  assert.equal(cancellationUnlocked.allowed, true); assert.equal(cancellationCalls, callsBeforeCancelledSubmit + 1);
  console.log("✓ 已完成批准后的冲突、未成年、未满14岁与遗留陈旧许可均创建当前周期；取消请求不可提交且仅新鲜成年证据解锁");

  const rejectedSubject = await fresh();
  const rejectedService = new AgeService(payload, rejectedSubject.owner, async () => ({ state: "adult", reference: "synthetic" }));
  await rejectedService.requireAdditionalVerification();
  const rejectedRequest = await rejectedService.requestReview();
  await assertProvenance(rejectedRequest.review!.receipt!, { source: "moderation", actor: "system:age-risk", reason: "内部年龄风险信号", evidence: "内部风险信号要求年龄复核。" });
  const rejectedRow = (await ops.queue(administrator, {})).find((row) => row.receipt === rejectedRequest.review?.receipt)!;
  await ops.action(administrator, Number(rejectedRow.id), { revision: 0, action: "claim", reason: "管理员领取维持限制的合成案件" });
  await ops.action(administrator, Number(rejectedRow.id), { revision: 1, action: "maintain_age_restriction", reason: "合成材料不足以允许重新核验", reply: "当前维持年龄限制，可再次申请复核。" });
  assert.equal((await rejectedService.status()).review?.state, "rejected");
  await assert.rejects(() => rejectedService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /批准/);
  const reconsidered = await rejectedService.requestReview();
  const reconsideredRow = (await ops.queue(administrator, {})).find((row) => row.receipt === reconsidered.review?.receipt)!;
  assert.equal(Number(reconsideredRow.parentId), Number(rejectedRow.id));
  await assertProvenance(reconsidered.review!.receipt!, { source: "appeal", actor: `owner:${rejectedSubject.owner.id}`, reason: "本人再次申请年龄复核", evidence: "本人就年龄限制结果再次申请复核。" });
  await ops.action(administrator, Number(reconsideredRow.id), { revision: 0, action: "claim", reason: "原处置管理员领取复议案件以验证独立复核限制" });
  await assert.rejects(() => ops.action(administrator, Number(reconsideredRow.id), { revision: 1, action: "permit_age_reverification", reason: "原处置管理员不得批准同一年龄事项的复议", reply: "允许重新核验。" }), /原处置人以外/);
  await ops.action(secondAdministrator, Number(reconsideredRow.id), { revision: 1, action: "claim", reason: "另一位系统管理员领取年龄复议案件" });
  await ops.action(secondAdministrator, Number(reconsideredRow.id), { revision: 2, action: "permit_age_reverification", reason: "独立管理员允许新的本人核验", reply: "可以重新发起本人年龄核验。" });
  await assert.rejects(() => ops.complain(rejectedSubject.owner, { kind: "appeal", category: "other", description: "通过普通帮助入口申诉年龄复核", parentReceipt: rejectedRow.receipt }), /年龄.*复核|专用/);
  const generic = await ops.complain(rejectedSubject.owner, { category: "other", description: "虚构用户申请核实年龄" });
  const genericRow = (await ops.queue(administrator, {})).find((row) => row.receipt === generic.receipt)!;
  await ops.action(administrator, Number(genericRow.id), { revision: 0, action: "claim", reason: "领取普通内容案件验证年龄限制隔离" });
  await ops.action(administrator, Number(genericRow.id), { revision: 1, action: "dismiss", reason: "普通内容案件无需采取内容限制" });
  assert.equal((await rejectedService.status()).review?.state, "approved");
  assert.equal((await rejectedService.status()).allowed, false);

  const staleSubject = await fresh();
  const staleService = new AgeService(payload, staleSubject.owner, async () => ({ state: "adult", reference: "synthetic" }));
  await staleService.requireAdditionalVerification();
  const staleRequest = await staleService.requestReview();
  const staleRow = (await ops.queue(administrator, {})).find((row) => row.receipt === staleRequest.review?.receipt)!;
  await ops.action(administrator, Number(staleRow.id), { revision: 0, action: "claim", reason: "管理员领取过期批准重放验证案件" });
  await ops.action(administrator, Number(staleRow.id), { revision: 1, action: "permit_age_reverification", reason: "先批准一次合成重新核验用于重放验证", reply: "可以重新发起本人核验。" });
  const staleChallenge = await staleService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  await staleService.requireAdditionalVerification();
  await assert.rejects(() => staleService.submit({ ...identity, challenge: staleChallenge.challenge }), /无效|过期/);
  assert.equal((await staleService.status()).review?.state, "pending");
  await assert.rejects(() => ops.action(administrator, Number(staleRow.id), { revision: 2, action: "review", reason: "旧案件不得在新风险周期重新打开" }), /更新周期|当前案件/);

  const under14Review = await fresh(); let under14Calls = 0;
  const under14ReviewService = new AgeService(payload, under14Review.owner, async () => { under14Calls++; return { state: "adult", reference: "synthetic-under14-adult" }; });
  await challenge(under14ReviewService, "under14");
  const under14Request = await under14ReviewService.requestReview();
  const under14Row = (await ops.queue(administrator, {})).find((row) => row.receipt === under14Request.review?.receipt)!;
  await ops.action(administrator, Number(under14Row.id), { revision: 0, action: "claim", reason: "管理员领取未满十四岁申报复核案件" });
  await ops.action(administrator, Number(under14Row.id), { revision: 1, action: "permit_age_reverification", reason: "允许本人通过既有身份核验入口提供新证据", reply: "可以重新发起本人年龄核验。" });
  const under14Duplicate = await under14ReviewService.requestReview();
  assert.equal(under14Duplicate.review?.receipt, under14Request.review?.receipt);
  const under14Fresh = await under14ReviewService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  assert.equal((await under14ReviewService.submit({ ...identity, challenge: under14Fresh.challenge })).allowed, true);
  assert.equal(under14Calls, 1);

  const under14Minor = await fresh(); let under14MinorCalls = 0;
  const under14MinorService = new AgeService(payload, under14Minor.owner, async () => { under14MinorCalls++; return { state: "minor", ageBand: "under14", reference: "synthetic-under14-minor" }; });
  await challenge(under14MinorService, "under14");
  const under14MinorRequest = await under14MinorService.requestReview();
  const under14MinorRow = (await ops.queue(administrator, {})).find((row) => row.receipt === under14MinorRequest.review?.receipt)!;
  await ops.action(administrator, Number(under14MinorRow.id), { revision: 0, action: "claim", reason: "管理员领取未满十四岁非成年结果复核案件" });
  await ops.action(administrator, Number(under14MinorRow.id), { revision: 1, action: "permit_age_reverification", reason: "允许本人核验但不预先解除任何限制", reply: "可以重新发起本人年龄核验。" });
  const under14MinorFresh = await under14MinorService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  const under14MinorResult = await under14MinorService.submit({ ...identity, challenge: under14MinorFresh.challenge });
  assert.equal(under14MinorResult.allowed, false); assert.equal(under14MinorResult.state, "needs_review"); assert.equal(under14MinorCalls, 1);
  assert.equal(under14MinorResult.review?.state, "pending");
  await assertProvenance(under14MinorResult.review!.receipt!, { source: "moderation", actor: "system:age-verification", reason: "本人核验的未成年结果", evidence: "本人核验返回新的未成年结果。" });
  await assert.rejects(() => under14MinorService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /批准/);

  const lateRisk = await fresh(); let releaseLateRisk!: (value: { state: "adult"; reference: string }) => void; let enteredLateRisk!: () => void;
  const lateRiskStarted = new Promise<void>((resolve) => { enteredLateRisk = resolve; });
  const lateRiskEvidence = new Promise<{ state: "adult"; reference: string }>((resolve) => { releaseLateRisk = resolve; });
  const lateRiskService = new AgeService(payload, lateRisk.owner, async () => { enteredLateRisk(); return lateRiskEvidence; });
  await lateRiskService.requireAdditionalVerification();
  const lateRiskRequest = await lateRiskService.requestReview();
  const lateRiskRow = (await ops.queue(administrator, {})).find((row) => row.receipt === lateRiskRequest.review?.receipt)!;
  await ops.action(administrator, Number(lateRiskRow.id), { revision: 0, action: "claim", reason: "管理员领取并发提交复核案件" });
  await ops.action(administrator, Number(lateRiskRow.id), { revision: 1, action: "permit_age_reverification", reason: "先允许一次本人核验以验证迟到结果", reply: "可以重新发起本人年龄核验。" });
  const lateRiskChallenge = await lateRiskService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version });
  const lateRiskSubmit = lateRiskService.submit({ ...identity, challenge: lateRiskChallenge.challenge });
  await lateRiskStarted;
  await ops.action(administrator, Number(lateRiskRow.id), { revision: 2, action: "review", reason: "核验过程中重新打开案件并维持限制" });
  await ops.action(secondAdministrator, Number(lateRiskRow.id), { revision: 3, action: "claim", reason: "另一管理员领取重新打开的年龄案件" });
  await ops.action(secondAdministrator, Number(lateRiskRow.id), { revision: 4, action: "maintain_age_restriction", reason: "新风险要求继续维持年龄限制", reply: "当前继续维持年龄限制。" });
  releaseLateRisk({ state: "adult", reference: "synthetic-late-adult" });
  await assert.rejects(() => lateRiskSubmit, /已变更|重新.*复核|无效/);
  assert.equal((await lateRiskService.status()).allowed, false);

  const atomicRisk = await fresh();
  const atomicRiskService = new AgeService(payload, atomicRisk.owner, async () => ({ state: "adult", reference: "synthetic-atomic-risk" }));
  await atomicRiskService.requireAdditionalVerification();
  const atomicRequest = await atomicRiskService.requestReview();
  const atomicRow = (await ops.queue(administrator, {})).find((row) => row.receipt === atomicRequest.review?.receipt)!;
  await ops.action(administrator, Number(atomicRow.id), { revision: 0, action: "claim", reason: "管理员领取原子风险登记验证案件" });
  await ops.action(administrator, Number(atomicRow.id), { revision: 1, action: "permit_age_reverification", reason: "先批准以验证新风险原子取代旧授权", reply: "可以重新发起本人年龄核验。" });
  let riskCreateEntered!: () => void; let releaseRiskCreate!: () => void;
  const riskCreateStarted = new Promise<void>((resolve) => { riskCreateEntered = resolve; });
  const riskCreateBarrier = new Promise<void>((resolve) => { releaseRiskCreate = resolve; });
  const originalCreate = payload.create.bind(payload);
  const createWithRiskBarrier: typeof payload.create = async (args) => {
    const value = args as unknown as { collection?: string; data?: { owner?: string; stage?: string } };
    if (value.collection === "safety-cases" && value.data?.owner === atomicRisk.owner.id && value.data.stage === "age_review") {
      riskCreateEntered(); await riskCreateBarrier;
    }
    return originalCreate(args as never);
  };
  payload.create = createWithRiskBarrier;
  const registerRisk = atomicRiskService.requireAdditionalVerification();
  await riskCreateStarted;
  await assert.rejects(() => atomicRiskService.reviewChallenge({ consent: true, noticeVersion: ageNotice().version }), /正在处理|database is locked/);
  releaseRiskCreate(); await registerRisk; payload.create = originalCreate;
  assert.equal((await atomicRiskService.status()).review?.state, "pending");
  console.log("✓ 年龄冲突→申请→管理员决定→全新成年证据解锁；拒绝、重复、越权和陈旧批准重放均保持限制");
  const cancelled = await fresh(); const cancelService = new AgeService(payload, cancelled.owner);
  await cancelService.cancel(); assert.equal((await cancelService.status()).state, "cancelled");
  console.log("✓ 未成年、未知、失败、服务异常、取消、未满14岁分流与申报冲突");

  const concurrent = await fresh(); let finish!: (value: { state: "adult"; reference: string }) => void; let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const waiting = new Promise<{ state: "adult"; reference: string }>((resolve) => { finish = resolve; });
  const concurrentService = new AgeService(payload, concurrent.owner, async () => { entered(); return waiting; });
  const prepared = await challenge(concurrentService);
  const submit = concurrentService.submit({ ...identity, challenge: prepared.challenge });
  await started;
  assert.equal((await concurrentService.status()).state, "pending");
  await assert.rejects(() => concurrentService.submit({ ...identity, challenge: prepared.challenge }), /正在处理/);
  await assert.rejects(() => challenge(concurrentService), /正在处理/);
  finish({ state: "adult", reference: "synthetic" }); assert.equal((await submit).allowed, true);
  const expired = await ageProfile(payload, concurrent.owner.id);
  await payload.update({ collection: "age-profiles", id: expired!.id, overrideAccess: true, data: { expiresAt: new Date(Date.now() - 1).toISOString() } });
  assert.equal((await concurrentService.status()).state, "expired");
  await assert.rejects(() => concurrentService.requireCapability(), /年龄/);

  const expiredLeaseSubject = await fresh(); let finishExpiredLease!: (value: { state: "adult"; reference: string }) => void; let enteredExpiredLease!: () => void;
  const expiredLeaseStarted = new Promise<void>((resolve) => { enteredExpiredLease = resolve; });
  const expiredLeaseEvidence = new Promise<{ state: "adult"; reference: string }>((resolve) => { finishExpiredLease = resolve; });
  const expiredLeaseService = new AgeService(payload, expiredLeaseSubject.owner, async () => { enteredExpiredLease(); return expiredLeaseEvidence; });
  const expiredLeaseChallenge = await challenge(expiredLeaseService);
  const expiredLeaseSubmit = expiredLeaseService.submit({ ...identity, challenge: expiredLeaseChallenge.challenge });
  await expiredLeaseStarted;
  await payload.update({ collection: "age-locks", overrideAccess: true, where: { key: { equals: `owner:${expiredLeaseSubject.owner.id}` } }, data: { expiresAt: new Date(Date.now() - 1).toISOString() } });
  finishExpiredLease({ state: "adult", reference: "synthetic-expired-lease" });
  await assert.rejects(() => expiredLeaseSubmit, /超时/);
  assert.equal((await expiredLeaseService.status()).allowed, false);

  const deletingSubject = await fresh(); let finishDeleting!: (value: { state: "adult"; reference: string }) => void; let enteredDeleting!: () => void;
  const deletingStarted = new Promise<void>((resolve) => { enteredDeleting = resolve; });
  const deletingEvidence = new Promise<{ state: "adult"; reference: string }>((resolve) => { finishDeleting = resolve; });
  const deletingService = new AgeService(payload, deletingSubject.owner, async () => { enteredDeleting(); return deletingEvidence; });
  const deletingChallenge = await challenge(deletingService);
  const deletingSubmit = deletingService.submit({ ...identity, challenge: deletingChallenge.challenge });
  await deletingStarted;
  const deletingPrivacy = (await payload.find({ collection: "privacy-profiles", overrideAccess: true, limit: 1, where: { owner: { equals: deletingSubject.owner.id } } })).docs[0];
  if (deletingPrivacy) await payload.update({ collection: "privacy-profiles", id: deletingPrivacy.id, overrideAccess: true, data: { state: "withdrawn" } });
  else await payload.create({ collection: "privacy-profiles", overrideAccess: true, data: { owner: deletingSubject.owner.id, state: "withdrawn", revision: 0 } });
  finishDeleting({ state: "adult", reference: "synthetic-deleting" });
  await assert.rejects(() => deletingSubmit, /停止处理/);
  assert.equal((await deletingService.status()).allowed, false);
  console.log("✓ 数据库并发锁、核验中查询与有效期失效");

  const exported = await privacy.exportData(); assert.ok(exported.ageVerification);
  const code = await privacy.recoveryCode(); assert.equal(await withRecoveredOwner(payload, code.code, async (id) => id), owner.id);
  assert.equal((await new AgeService(payload, { id: owner.id, auth: "cookie" }).status()).allowed, false);
  await privacy.deleteData();
  assert.equal((await payload.count({ collection: "wechat-identities", overrideAccess: true, where: { owner: { equals: owner.id } } })).totalDocs, 0);
  assert.equal(await ageProfile(payload, owner.id), undefined);
  for (const collection of ["age-profiles", "wechat-identities", "age-locks", "credentials", "privacy-profiles"] as const) {
    const rows = await payload.find({ collection, overrideAccess: true, pagination: false });
    assert.ok(!JSON.stringify(rows).includes(identity.name)); assert.ok(!JSON.stringify(rows).includes(identity.idCard));
  }
  for (const file of await readdir(dir)) { const content = await readFile(path.join(dir, file)); assert.ok(!content.includes(Buffer.from(identity.idCard))); assert.ok(!content.includes(Buffer.from(identity.name))); }
  console.log("✓ 导出包含最小年龄状态、删除微信和年龄关联、恢复不授予微信权限、库及日志无姓名证件");
  const { maintainPrivacy } = await import("../src/privacy/maintenance");
  const { writeDeletionLedger } = await import("../src/privacy/deletion-ledger");
  const orphan = "synthetic-unfinished-onboarding";
  await payload.create({ collection: "wechat-identities", overrideAccess: true, data: { owner: orphan, key: "synthetic-orphan-key" } });
  await payload.create({ collection: "age-profiles", overrideAccess: true, data: { owner: orphan, state: "unknown" } });
  await payload.db.drizzle.run(sql`UPDATE age_profiles SET updated_at = '2020-01-01T00:00:00.000Z' WHERE owner = ${orphan}`);
  await payload.db.drizzle.run(sql`UPDATE wechat_identities SET updated_at = '2020-01-01T00:00:00.000Z' WHERE owner = ${orphan}`);
  assert.ok((await maintainPrivacy(payload, { apply: false })).eligibleIdentities >= 1);
  await maintainPrivacy(payload, { apply: true }); assert.equal(await ageProfile(payload, orphan), undefined);
  const restoredOnly = "synthetic-restore-age-only";
  await writeDeletionLedger(restoredOnly);
  await payload.create({ collection: "wechat-identities", overrideAccess: true, data: { owner: restoredOnly, key: "synthetic-restore-key" } });
  await payload.create({ collection: "age-profiles", overrideAccess: true, data: { owner: restoredOnly, state: "unknown" } });
  await maintainPrivacy(payload, { apply: true, restoreLedger: process.env.HELLO_PRIVACY_DELETION_LEDGER });
  assert.equal(await ageProfile(payload, restoredOnly), undefined);
  console.log("✓ 未完成授权的年龄/微信记录到期清理、仅含年龄记录的备份也重放删除清单");
} finally { await payload.destroy(); await rm(dir, { recursive: true, force: true }); }
