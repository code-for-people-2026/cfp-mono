import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BasePayload, buildConfig, type Payload } from "payload";
import { sqliteAdapter, sql, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { privacyCollections } from "./collections";
import { updateProfile } from "./profile-store";
import { PrivacyService, profileFor, recoverOwner, withRecoveredOwner } from "./service";
import { authenticate, mintCredential } from "../server/auth";
import { POST } from "../app/api/hello/[...path]/route";
import { POST as mcpPost } from "../app/api/mcp/route";
import { Repository } from "../cms/repository";
import { privacyPolicy } from "./policy";
import { up as initialPreview } from "../cms/migrations/20260930_123608_initial_preview";
import { up as initial } from "../cms/migrations/20261013_151000_privacy_lifecycle";
import { up as historyInspection } from "../cms/migrations/20261013_175000_privacy_history_inspection";
import { up as revision } from "../cms/migrations/20261013_174000_privacy_revision";

// No operations collections or production database: this exercises the real
// Payload profile reads, SQLite CAS and additive migration in isolation.
vi.mock("../operations/retention", () => ({ eraseOperationsEvidence: vi.fn() }));
const holder = vi.hoisted(() => ({ payload: undefined as Payload | undefined }));
vi.mock("../cms/client", () => ({ cms: () => holder.payload }));
const business = vi.hoisted(() => ({ createSession: vi.fn(), generate: vi.fn(), history: vi.fn(), image: vi.fn() }));
vi.mock("../domain/greetings", () => ({ GreetingService: class {
  constructor(readonly repo: Repository) {}
  createSession() { return business.createSession(); }
  generateGreeting() { return business.generate(); }
  history() { return business.history(); }
  media = { read: () => business.image() };
} }));
beforeEach(() => {
  business.createSession.mockReset().mockResolvedValue({ id: 7 });
  business.generate.mockReset().mockResolvedValue({ id: 1, greeting: "synthetic reply", artifacts: [], status: "completed" });
  business.history.mockReset().mockResolvedValue([{ id: 1, greeting: "synthetic history" }]);
  business.image.mockReset().mockResolvedValue({ bytes: Buffer.from("synthetic-image"), mimeType: "image/jpeg" });
});
vi.mock("../domain/context", () => ({ ContextService: class {} }));
vi.mock("./deletion-ledger", () => ({ writeDeletionLedger: vi.fn() }));
let payload: Payload, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hello-profile-cas-"));
  payload = await new BasePayload().init({ config: buildConfig({
    secret: "isolated-profile-test", telemetry: false,
    db: sqliteAdapter({ client: { url: `file:${directory}/profiles.db` }, push: false, transactionOptions: {} }),
    collections: [...privacyCollections, { slug: "admins", auth: true, fields: [] }, { slug: "credentials", fields: [{ name: "owner", type: "text" }, { name: "kind", type: "text" }, { name: "digest", type: "text" }, { name: "expiresAt", type: "date" }] }],
  }) });
  holder.payload = payload;
  const args = { db: payload.db.drizzle } as MigrateUpArgs;
  await initialPreview(args);
  await initial(args);
  await payload.db.drizzle.run(sql`INSERT INTO privacy_profiles (owner, state, consent) VALUES ('legacy', 'withdrawn', '{"core":true}')`);
  await revision(args);
  await historyInspection(args);
}, 15_000);
afterAll(async () => { await payload?.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });
const consent = () => ({ version: privacyPolicy().version, core: true, model: true, sensitive: false, external: false });
async function setup(owner: string) {
  await payload.create({ collection: "privacy-profiles", overrideAccess: true, data: { owner, revision: 0, state: "active", consent: consent(), expiresAt: "2020-01-01T00:00:00.000Z" } });
  return new PrivacyService(new Repository(payload, { id: owner, auth: "cookie" }));
}
it("增量迁移保留已有授权，版本从零开始", async () => {
  const legacy = (await profileFor(payload, "legacy"))!;
  expect(legacy).toMatchObject({ state: "withdrawn", revision: 0, historyInspected: false, consent: { core: true } });
  await updateProfile(payload, legacy, { historyInspected: true });
  expect(await profileFor(payload, "legacy")).toMatchObject({ revision: 1, historyInspected: true, consent: { core: true } });
});
it("迟到的授权请求不能撤销已完成的撤回；重新读取后可主动再授权", async () => {
  const service = await setup("delayed-consent");
  const read = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const originalFind = payload.find.bind(payload);
  const find = vi.spyOn(payload, "find").mockImplementationOnce(async (options) => {
    const result = await originalFind(options);
    read.resolve(); await resume.promise; return result;
  });
  const delayed = service.consent(consent());
  const rejected = expect(delayed).rejects.toMatchObject({ status: 409 });
  try {
    await read.promise;
    await service.withdraw();
    resume.resolve(); await rejected;
    expect(await profileFor(payload, "delayed-consent")).toMatchObject({ state: "withdrawn", revision: 1 });
    await expect(service.require()).rejects.toMatchObject({ status: 403 });
    await service.consent(consent());
    expect(await profileFor(payload, "delayed-consent")).toMatchObject({ state: "active", revision: 2 });
  } finally { resume.resolve(); find.mockRestore(); }
});
it("同一版本的并发授权修改最多成功一次，不覆盖赢家的选择", async () => {
  await setup("competing");
  const profile = (await profileFor(payload, "competing"))!;
  const results = await Promise.allSettled([
    updateProfile(payload, profile, { consent: { ...consent(), sensitive: true } }),
    updateProfile(payload, profile, { state: "withdrawn" }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  expect((await profileFor(payload, "competing"))!.revision).toBe(1);
});
it("删除冻结后，旧授权与敏感历史写入均不能恢复资料", async () => {
  await setup("deleting");
  const profile = (await profileFor(payload, "deleting"))!;
  await updateProfile(payload, profile, { state: "deleting" });
  await expect(updateProfile(payload, profile, { state: "active" })).rejects.toMatchObject({ status: 409 });
  await expect(updateProfile(payload, profile, { sensitiveHistory: true })).rejects.toMatchObject({ status: 409 });
  expect(await profileFor(payload, "deleting")).toMatchObject({ state: "deleting", sensitiveHistory: false, revision: 1 });
});

it.each(["deleting", "deleted"] as const)("%s 资料不能恢复或重新签发凭证", async (state) => {
  const service = await setup(`recover-${state}`);
  const { code } = await service.recoveryCode();
  await updateProfile(payload, (await profileFor(payload, service.repo.owner.id))!, { state });
  await expect(recoverOwner(payload, code)).rejects.toMatchObject({ status: 401 });
  await expect(mintCredential(payload, "cookie", service.repo.owner.id)).rejects.toMatchObject({ status: 409 });
});
it("旧 bearer 的缓存鉴权跨过恢复后，token 路由重新鉴权拒绝续签", async () => {
  const service = await setup("old-bearer");
  await updateProfile(payload, (await profileFor(payload, service.repo.owner.id))!, { consent: { ...consent(), external: true, externalRecipient: { name: "测试客户端", contact: "test@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" } }, expiresAt: "2099-01-01T00:00:00.000Z", historyInspected: true });
  const { code } = await service.recoveryCode();
  const old = await mintCredential(payload, "bearer", service.repo.owner.id);
  const read = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const originalFind = payload.find.bind(payload);
  const find = vi.spyOn(payload, "find").mockImplementationOnce(async (options) => {
    const result = await originalFind(options); read.resolve(); await resume.promise; return result;
  });
  vi.stubEnv("HELLO_ORIGIN", "http://localhost");
  const pending = POST(new Request("http://localhost/api/hello/token", { method: "POST", headers: { origin: "http://localhost", authorization: `Bearer ${old.token}` } }), { params: Promise.resolve({ path: ["token"] }) });
  try {
    await read.promise;
    const current = await withRecoveredOwner(payload, code, (owner) => mintCredential(payload, "cookie", owner));
    resume.resolve(); const response = await pending; expect({ status: response.status, body: await response.json() }).toMatchObject({ status: 401 });
    expect(await authenticate(payload, new Request("http://localhost", { headers: { cookie: `hello_identity=${current.token}` } }))).toMatchObject({ id: service.repo.owner.id, auth: "cookie" });
    const credentials = await payload.find({ collection: "credentials", overrideAccess: true, where: { owner: { equals: service.repo.owner.id } } });
    expect(credentials.docs.map((row) => row.kind)).toEqual(["cookie"]);
  } finally { resume.resolve(); await pending; find.mockRestore(); vi.unstubAllEnvs(); }
});
it("恢复在签发前持有身份保护，删除须重试且完成后不残留新凭证", async () => {
  const service = await setup("recovery-delete");
  const { code } = await service.recoveryCode();
  const issued = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const pending = withRecoveredOwner(payload, code, async (owner) => {
    issued.resolve(); await resume.promise; return mintCredential(payload, "cookie", owner);
  });
  const list = vi.spyOn(service.repo, "list").mockResolvedValue([]);
  const media = vi.spyOn(service.media, "deleteAll").mockResolvedValue(undefined);
  const originalDelete = payload.delete.bind(payload);
  const erase = vi.spyOn(payload, "delete").mockImplementation((options) => options.collection === "credentials" ? originalDelete(options) : Promise.resolve({ docs: [], errors: [] }) as ReturnType<typeof payload.delete>);
  try {
    await issued.promise;
    await expect(service.deleteData()).rejects.toMatchObject({ status: 409 });
    resume.resolve(); await pending;
    await service.deleteData();
    const deleted = (await profileFor(payload, service.repo.owner.id))!;
    expect(deleted.state).toBe("deleted");
    await expect(updateProfile(payload, deleted, { state: "deleting" })).rejects.toMatchObject({ status: 409 });
    // A restored snapshot can contain both a deleted tombstone and old rows.
    await payload.create({ collection: "credentials", overrideAccess: true, data: { owner: service.repo.owner.id, kind: "cookie", digest: "restored-old-credential", expiresAt: "2099-01-01T00:00:00.000Z" } });
    await service.deleteData();
    expect(await profileFor(payload, service.repo.owner.id)).toMatchObject({ state: "deleted", deletedAt: deleted.deletedAt });
    expect((await payload.find({ collection: "credentials", overrideAccess: true, where: { owner: { equals: service.repo.owner.id } } })).docs).toHaveLength(0);
  } finally { resume.resolve(); await pending; list.mockRestore(); media.mockRestore(); erase.mockRestore(); }
});
it("恢复的旧查找快照跨过删除后仍须重新检查，不签发凭证", async () => {
  const service = await setup("stale-recovery");
  const { code } = await service.recoveryCode();
  const read = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const originalFind = payload.find.bind(payload);
  const find = vi.spyOn(payload, "find").mockImplementationOnce(async (options) => {
    const result = await originalFind(options); read.resolve(); await resume.promise; return result;
  });
  const issue = vi.fn((owner: string) => mintCredential(payload, "cookie", owner));
  const pending = withRecoveredOwner(payload, code, issue);
  const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
  try {
    await read.promise;
    await updateProfile(payload, (await profileFor(payload, service.repo.owner.id))!, { state: "deleted" });
    resume.resolve(); await rejected;
    expect(issue).not.toHaveBeenCalled();
  } finally { resume.resolve(); find.mockRestore(); }
});

it("恢复遇到批量撤销部分失败时不签发新凭证，可重试", async () => {
  const service = await setup("recovery-partial-failure");
  const { code } = await service.recoveryCode();
  const old = await mintCredential(payload, "cookie", service.repo.owner.id);
  const issue = vi.fn((owner: string) => mintCredential(payload, "cookie", owner));
  const erase = vi.spyOn(payload, "delete").mockResolvedValueOnce({ docs: [], errors: [{ id: 1, isPublic: false, message: "simulated partial failure" }] });
  try {
    await expect(withRecoveredOwner(payload, code, issue)).rejects.toMatchObject({ status: 503 });
    expect(issue).not.toHaveBeenCalled();
    const request = new Request("http://localhost", { headers: { cookie: `hello_identity=${old.token}` } });
    await expect(authenticate(payload, request)).resolves.toMatchObject({ id: service.repo.owner.id });
    await withRecoveredOwner(payload, code, issue);
    expect(issue).toHaveBeenCalledTimes(1);
    await expect(authenticate(payload, request)).rejects.toMatchObject({ status: 401 });
  } finally { erase.mockRestore(); }
});

const mutationCases = (["cookie", "miniapp"] as const).flatMap((kind) => ["delete", "consent", "withdraw", "recovery-code", "logout"].map((action) => ({ kind, action })));
it.each(mutationCases)("$kind 的旧 $action 请求跨过恢复后不能修改资料或撤销新凭证", async ({ kind, action }) => {
  const service = await setup(`stale-${kind}-${action}`);
  const { code } = await service.recoveryCode();
  const originalProfile = await profileFor(payload, service.repo.owner.id);
  const old = await mintCredential(payload, kind, service.repo.owner.id);
  const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const hasBody = action === "consent" || action === "delete";
  const body = action === "delete" ? { confirmation: "删除我的全部在线数据" } : { ...consent(), sensitive: true };
  const stream = hasBody ? new ReadableStream<Uint8Array>({ async pull(controller) {
    paused.resolve(); await resume.promise;
    controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
  } }, { highWaterMark: 0 }) : undefined;
  const originalFind = payload.find.bind(payload);
  const find = !hasBody ? vi.spyOn(payload, "find").mockImplementationOnce(async (options) => {
    const result = await originalFind(options); paused.resolve(); await resume.promise; return result;
  }) : undefined;
  vi.stubEnv("HELLO_ORIGIN", "http://localhost");
  const init: RequestInit & { duplex?: "half" } = { method: "POST", headers: kind === "cookie" ? { origin: "http://localhost", cookie: `hello_identity=${old.token}` } : { authorization: `Bearer ${old.token}` }, ...(stream ? { body: stream, duplex: "half" } : {}) };
  const pending = POST(new Request(`http://localhost/api/hello/privacy/${action}`, init), { params: Promise.resolve({ path: ["privacy", action] }) });
  try {
    await paused.promise;
    const recovered = await withRecoveredOwner(payload, code, (owner) => mintCredential(payload, "cookie", owner));
    resume.resolve(); const response = await pending;
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await profileFor(payload, service.repo.owner.id)).toEqual(originalProfile);
    await expect(authenticate(payload, new Request("http://localhost", { headers: { cookie: `hello_identity=${recovered.token}` } }))).resolves.toMatchObject({ id: service.repo.owner.id });
    expect((await payload.find({ collection: "credentials", overrideAccess: true, where: { owner: { equals: service.repo.owner.id } } })).docs.map((row) => row.kind)).toEqual(["cookie"]);
  } finally { resume.resolve(); await pending; find?.mockRestore(); vi.unstubAllEnvs(); }
});
it("接收方变更前旧 bearer 撤销失败，授权与历史保持原样，重试成功后旧凭证失效", async () => {
  const service = await setup("recipient-change");
  const recipient = { name: "原接收方", contact: "old@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" };
  await updateProfile(payload, (await profileFor(payload, service.repo.owner.id))!, { consent: { ...consent(), external: true, externalRecipient: recipient }, expiresAt: "2099-01-01T00:00:00.000Z" });
  const before = (await profileFor(payload, service.repo.owner.id))!;
  const old = await mintCredential(payload, "bearer", service.repo.owner.id);
  const next = { ...consent(), external: true, externalRecipient: { ...recipient, name: "新接收方", contact: "new@example.invalid" } };
  const erase = vi.spyOn(payload, "delete").mockResolvedValueOnce({ docs: [], errors: [{ id: 1, isPublic: false, message: "simulated partial failure" }] });
  try {
    await expect(service.consent(next)).rejects.toMatchObject({ status: 503 });
    expect(await profileFor(payload, service.repo.owner.id)).toEqual(before);
    const request = new Request("http://localhost", { headers: { authorization: `Bearer ${old.token}` } });
    await expect(authenticate(payload, request)).resolves.toMatchObject({ id: service.repo.owner.id });
    await service.consent(next);
    expect(await profileFor(payload, service.repo.owner.id)).toMatchObject({ revision: before.revision + 1, consent: next });
    await expect(authenticate(payload, request)).rejects.toMatchObject({ status: 401 });
  } finally { erase.mockRestore(); }
});

async function authorized(owner: string) {
  const service = await setup(owner);
  await updateProfile(payload, (await profileFor(payload, owner))!, { consent: { ...consent(), sensitive: true, external: true, externalRecipient: { name: "接收方 A", contact: "a@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" } }, expiresAt: "2099-01-01T00:00:00.000Z", historyInspected: true });
  return service;
}
const agentBody = () => ({ protocolVersion: "1.0", threadId: "7", runId: crypto.randomUUID(), tools: [], context: [], messages: [{ id: "u", role: "user", content: "test" }], forwardedProps: { mode: "platform", mediaIds: [] } });
function delayedRequest(url: string, headers: Record<string, string>, body: unknown) {
  const paused = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
    paused.resolve(); await resume.promise;
    controller.enqueue(new TextEncoder().encode(JSON.stringify(body))); controller.close();
  } }, { highWaterMark: 0 });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers, body: stream, duplex: "half" };
  return { paused, resume, request: new Request(url, init) };
}
it.each((["cookie", "miniapp"] as const).flatMap((kind) => ["sessions", "greet", "ag-ui"].map((route) => ({ kind, route }))))("$kind 延迟 $route 正文跨过恢复后拒绝执行业务", async ({ kind, route }) => {
  const service = await authorized(`business-${kind}-${route}`);
  const { code } = await service.recoveryCode();
  const old = await mintCredential(payload, kind, service.repo.owner.id);
  const headers: Record<string, string> = kind === "cookie" ? { origin: "http://localhost", cookie: `hello_identity=${old.token}` } : { authorization: `Bearer ${old.token}` };
  const body = route === "ag-ui" ? agentBody() : route === "sessions" ? { title: "new" } : { sessionId: 7, requestId: crypto.randomUUID(), mode: "platform", input: { text: "表单回应", formResponse: { turnId: 1, artifactId: "form", values: { answer: "yes" } } } };
  const delayed = delayedRequest(`http://localhost/api/hello/${route}`, headers, body);
  vi.stubEnv("HELLO_ORIGIN", "http://localhost");
  const pending = POST(delayed.request, { params: Promise.resolve({ path: [route] }) });
  try {
    await delayed.paused.promise;
    await withRecoveredOwner(payload, code, (owner) => mintCredential(payload, "cookie", owner));
    delayed.resume.resolve(); expect((await pending).status).toBe(401);
    expect(business.createSession).not.toHaveBeenCalled(); expect(business.generate).not.toHaveBeenCalled();
  } finally { delayed.resume.resolve(); await pending; vi.unstubAllEnvs(); }
});
const rpcHeaders = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" });
it.each(["recovery", "recipient"].flatMap((change) => ["hello_get_history", "hello_get_image"].map((tool) => ({ change, tool }))))("MCP $tool 延迟正文跨过 $change 后旧 token 失效，新连接仍可执行真实传输", async ({ change, tool }) => {
  const service = await authorized(`mcp-${change}-${tool}`);
  const { code } = await service.recoveryCode();
  const old = await mintCredential(payload, "bearer", service.repo.owner.id);
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: tool === "hello_get_image" ? { mediaId: 1 } : { sessionId: 7 } } };
  const delayed = delayedRequest("http://localhost/api/mcp", rpcHeaders(old.token), body);
  const pending = mcpPost(delayed.request);
  try {
    await delayed.paused.promise;
    if (change === "recovery") await withRecoveredOwner(payload, code, (owner) => mintCredential(payload, "cookie", owner));
    else await service.consent({ ...consent(), sensitive: true, external: true, externalRecipient: { name: "接收方 B", contact: "b@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" } });
    delayed.resume.resolve(); expect((await pending).status).toBe(401);
    expect(business.history).not.toHaveBeenCalled(); expect(business.image).not.toHaveBeenCalled();
    const current = await mintCredential(payload, "bearer", service.repo.owner.id);
    const response = await mcpPost(new Request("http://localhost/api/mcp", { method: "POST", headers: rpcHeaders(current.token), body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect((await response.json()).result.isError).not.toBe(true);
    expect(tool === "hello_get_image" ? business.image : business.history).toHaveBeenCalledTimes(1);
  } finally { delayed.resume.resolve(); await pending; }
});
it.each(["success", "failure", "disconnect"])("AG-UI %s 在后台生成结束前持续保护凭证，之后可恢复", async (mode) => {
  const service = await authorized(`stream-${mode}`);
  const { code } = await service.recoveryCode();
  const credential = await mintCredential(payload, "cookie", service.repo.owner.id);
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  business.generate.mockImplementationOnce(async () => { started.resolve(); await finish.promise; if (mode === "failure") throw new Error("injected provider error"); return { id: 1, greeting: "ok", artifacts: [], status: "completed" }; });
  vi.stubEnv("HELLO_ORIGIN", "http://localhost");
  const response = await POST(new Request("http://localhost/api/hello/ag-ui", { method: "POST", headers: { origin: "http://localhost", cookie: `hello_identity=${credential.token}` }, body: JSON.stringify(agentBody()) }), { params: Promise.resolve({ path: ["ag-ui"] }) });
  try {
    expect(response.status).toBe(200); await started.promise;
    const consumed = mode === "disconnect" ? response.body!.cancel() : response.text();
    await expect(recoverOwner(payload, code)).rejects.toMatchObject({ status: 409 });
    finish.resolve(); await consumed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(recoverOwner(payload, code)).resolves.toBe(service.repo.owner.id);
  } finally { finish.resolve(); vi.unstubAllEnvs(); }
});

it("MCP 工具执行结束前不能恢复身份，真实 JSON 传输完成后释放保护", async () => {
  const service = await authorized("mcp-active-execution");
  const { code } = await service.recoveryCode();
  const credential = await mintCredential(payload, "bearer", service.repo.owner.id);
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  business.history.mockImplementationOnce(async () => { started.resolve(); await finish.promise; return [{ id: 1, greeting: "synthetic history" }]; });
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hello_get_history", arguments: { sessionId: 7 } } };
  const pending = mcpPost(new Request("http://localhost/api/mcp", { method: "POST", headers: rpcHeaders(credential.token), body: JSON.stringify(body) }));
  try {
    await started.promise;
    await expect(recoverOwner(payload, code)).rejects.toMatchObject({ status: 409 });
    finish.resolve();
    const response = await pending;
    expect(response.status).toBe(200);
    expect((await response.json()).result.isError).not.toBe(true);
    await expect(recoverOwner(payload, code)).resolves.toBe(service.repo.owner.id);
  } finally { finish.resolve(); await pending; }
});
