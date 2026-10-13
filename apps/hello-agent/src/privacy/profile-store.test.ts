import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BasePayload, buildConfig, type Payload } from "payload";
import { sqliteAdapter, sql, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { privacyCollections } from "./collections";
import { updateProfile } from "./profile-store";
import { PrivacyService, profileFor, recoverOwner, withRecoveredOwner } from "./service";
import { authenticate, mintCredential } from "../server/auth";
import { POST } from "../app/api/hello/[...path]/route";
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
vi.mock("../domain/greetings", () => ({ GreetingService: class {} }));
vi.mock("../domain/context", () => ({ ContextService: class {} }));
vi.mock("../server/ag-ui", () => ({ agentStream: vi.fn(), readAgentInput: vi.fn() }));
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
