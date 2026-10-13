import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BasePayload, buildConfig, type Payload } from "payload";
import { sqliteAdapter, sql, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { privacyCollections } from "./collections";
import { updateProfile } from "./profile-store";
import { PrivacyService, profileFor } from "./service";
import { Repository } from "../cms/repository";
import { privacyPolicy } from "./policy";
import { up as initialPreview } from "../cms/migrations/20260930_123608_initial_preview";
import { up as initial } from "../cms/migrations/20261013_151000_privacy_lifecycle";
import { up as revision } from "../cms/migrations/20261013_174000_privacy_revision";

// No operations collections or production database: this exercises the real
// Payload profile reads, SQLite CAS and additive migration in isolation.
vi.mock("../operations/retention", () => ({ eraseOperationsEvidence: vi.fn() }));
let payload: Payload, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "hello-profile-cas-"));
  payload = await new BasePayload().init({ config: buildConfig({
    secret: "isolated-profile-test", telemetry: false,
    db: sqliteAdapter({ client: { url: `file:${directory}/profiles.db` }, push: false, transactionOptions: {} }),
    collections: [...privacyCollections, { slug: "credentials", fields: [{ name: "owner", type: "text" }, { name: "kind", type: "text" }] }],
  }) });
  const args = { db: payload.db.drizzle } as MigrateUpArgs;
  await initialPreview(args);
  await initial(args);
  await payload.db.drizzle.run(sql`INSERT INTO privacy_profiles (owner, state, consent) VALUES ('legacy', 'withdrawn', '{"core":true}')`);
  await revision(args);
}, 15_000);
afterAll(async () => { await payload?.destroy(); if (directory) await rm(directory, { recursive: true, force: true }); });
const consent = () => ({ version: privacyPolicy().version, core: true, model: true, sensitive: false, external: false });
async function setup(owner: string) {
  await payload.create({ collection: "privacy-profiles", overrideAccess: true, data: { owner, revision: 0, state: "active", consent: consent(), expiresAt: "2020-01-01T00:00:00.000Z" } });
  return new PrivacyService(new Repository(payload, { id: owner, auth: "cookie" }));
}
it("增量迁移保留已有授权，版本从零开始", async () => {
  expect(await profileFor(payload, "legacy")).toMatchObject({ state: "withdrawn", revision: 0, consent: { core: true } });
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
