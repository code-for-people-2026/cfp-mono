// Synthetic identity/provider inputs are injected only into this isolated script.
// No application endpoint or environment flag can return a synthetic adult result.
import { sql } from "@payloadcms/db-sqlite";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  const minted = await http(linked.token, ["token"], {}); assert.equal(minted.status, 200);
  const bearer = (await minted.json()).token;
  assert.equal((await authenticate(payload, nativeReq(bearer), true)).wechatKey, owner.wechatKey);
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
    assert.equal((await instance.submit({ ...identity, challenge: prepared.challenge })).state, state);
    await assert.rejects(() => instance.requireCapability(), /年龄/);
    if (state === "minor") { await instance.cancel(); assert.equal((await instance.status()).state, "minor"); await assert.rejects(() => challenge(instance), /复核/); }
    assert.equal(calls, 1);
  }
  const child = await fresh(); let childCalls = 0;
  const childService = new AgeService(payload, child.owner, async () => { childCalls++; return { state: "adult" }; });
  const childResult = await challenge(childService, "under14");
  assert.equal(childResult.challenge, null); assert.equal(childResult.status.allowed, false); assert.equal(childCalls, 0);
  const conflict = await fresh(); const conflictService = new AgeService(payload, conflict.owner, async () => ({ state: "adult", reference: "synthetic" }));
  const conflicting = await challenge(conflictService, "14to17");
  assert.equal((await conflictService.submit({ ...identity, challenge: conflicting.challenge })).state, "needs_review");
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
