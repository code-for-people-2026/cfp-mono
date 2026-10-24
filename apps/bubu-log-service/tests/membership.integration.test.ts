import { testPrivacyConfig, grantFixturePrivacy } from "./fixtures/privacy";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRuntime, type BubuRuntime } from "../src/runtime";
import { bootstrapOpsAdmin } from "../src/operations/collections";
import { readOpsUser, type OpsUser } from "../src/operations/access";
import { OperationsService } from "../src/operations/service";
import type { MembershipCommand } from "../src/membership/contracts";
import type { Principal } from "../src/identity";
import { permissions } from "../src/contracts";
import { RecordsLegacyFixture } from "./fixtures/records";
import { WechatFixture } from "./fixtures/identity";

describe("宝宝共享的免费服务配置与原生运营持久化", () => {
  let runtime: BubuRuntime, directory: string, operations: OperationsService, admin: OpsUser, auditor: OpsUser, alice: Principal, bob: Principal, token: string;
  let now = Date.parse("2026-10-23T12:00:00Z"), serial = 0;
  const legacy = new RecordsLegacyFixture(), origin = "http://127.0.0.1:4339";
  const options = () => ({ privacy: testPrivacyConfig, directory, publicOrigin: origin, opsOrigin: origin, mcpUrl: `${origin}/api/mcp`, legacy, wechat: new WechatFixture() });
  const command = (input: MembershipCommand, requestId = `membership-test-${++serial}`) => ({ babyId: "baby-a", requestId, reason: "合成权益状态配置验证", command: { type: "membership" as const, input } });
  const status = () => runtime.membership.status(alice, "baby-a");
  async function configure(overrides: Partial<Extract<MembershipCommand, { action: "configure" }>> = {}) {
    return operations.execute(admin, command({ action: "configure", expectedVersion: (await status()).version, startsAt: null, endsAt: null, expiryPolicy: null, ...overrides }));
  }
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-membership-config-"));
    runtime = await createRuntime(options()); vi.spyOn(runtime.identity, "now").mockImplementation(() => now);
    await grantFixturePrivacy(runtime);
    const first = await bootstrapOpsAdmin(runtime.store.payload, { email: "member-admin@fixture.invalid", password: "Synthetic-Password-2026", babyIds: ["baby-a", "baby-b"] });
    admin = await readOpsUser(runtime.store.payload, { ...first, collection: "ops-users" });
    const doc = await runtime.store.payload.create({ collection: "ops-users", overrideAccess: false, user: admin, data: { email: "member-auditor@fixture.invalid", password: "Synthetic-Password-2026", role: "auditor", active: true, babyIds: ["baby-a"] } });
    auditor = await readOpsUser(runtime.store.payload, { ...doc, collection: "ops-users" });
    token = (await runtime.identity.loginLegacy("old-alice", "correct-password", "native")).token;
    alice = await runtime.identity.authenticate(token, "bearer");
    bob = await runtime.identity.authenticate((await runtime.identity.loginLegacy("old-bob", "correct-password", "native")).token, "bearer");
    operations = new OperationsService(runtime, runtime.membership);
  }, 60_000);
  afterAll(async () => { vi.restoreAllMocks(); await runtime?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

  it("unconfigured is free without an invented deadline, and reads create no policy rows", async () => {
    expect(await status()).toMatchObject({ version: 0, configured: false, status: "free", startsAt: null, endsAt: null, entitlements: { chat: true, collection: true, history: true }, payment: { enabled: false } });
    expect((await runtime.store.payload.count({ collection: "service-memberships", overrideAccess: true })).totalDocs).toBe(0);
    const response = await runtime.handler(new Request(`${origin}/api/app/membership?babyId=baby-a`, { headers: { Authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("changes");
  });
  it("permissions remain distinct from shared service entitlement", async () => {
    await expect(runtime.membership.status(bob, "baby-a")).rejects.toMatchObject({ code: "BABY_FORBIDDEN" });
    await expect(runtime.membership.execute(alice, "baby-a", "caregiver-change", { action: "pause", expectedVersion: 0 }, "未授权的照护者变更")).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    await expect(operations.execute(auditor, command({ action: "pause", expectedVersion: 0 }))).rejects.toMatchObject({ code: "OPS_FORBIDDEN" });
    const issued = await runtime.identity.provisionOperator(`ops:${admin.id}`, "baby-a", 60_000, { userId: String(admin.id), permissions });
    const principal = await runtime.identity.authenticate(issued.token);
    await runtime.identity.setGrant(principal, "baby-a", bob.subjectId, "active", ["records:read", "media:read"]);
    expect((await runtime.membership.status(bob, "baby-a")).version).toBe((await status()).version);
    await runtime.identity.logout(principal);
  });
  it("payment HTTP operations stay explicitly disabled", async () => {
    for (const operation of ["create", "query", "refund", "close", "notify"]) {
      const response = await runtime.handler(new Request(`${origin}/api/payments/${operation}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
      }));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "PAYMENT_DISABLED", retryable: false });
    }
  });
  it("cutoff alone does not stop service; only explicit independent expiry decisions do", async () => {
    await configure({ endsAt: "2026-10-23T11:00:00Z" });
    expect(await status()).toMatchObject({ status: "expired", entitlements: { chat: true, collection: true } });
    await configure({ endsAt: "2026-10-23T11:00:00Z", expiryPolicy: { chat: "continue", collection: "pause" } });
    expect(await status()).toMatchObject({ status: "expired", entitlements: { chat: true, collection: false, history: true } });
    await expect(runtime.membership.requireAvailable("baby-a", "collection")).rejects.toMatchObject({ status: 423, code: "SERVICE_EXPIRED", retryable: true });
    await runtime.membership.requireAvailable("baby-a", "chat");
  });
  it("extends the configured deadline without unpausing an explicitly paused service", async () => {
    await operations.execute(admin, command({ action: "pause", expectedVersion: (await status()).version }));
    await operations.execute(admin, command({ action: "extend", expectedVersion: (await status()).version, endsAt: "2026-10-24T12:00:00Z" }));
    expect(await status()).toMatchObject({ status: "paused", endsAt: "2026-10-24T12:00:00Z", entitlements: { chat: false, collection: false, history: true } });
    await operations.execute(admin, command({ action: "resume", expectedVersion: (await status()).version }));
    expect(await status()).toMatchObject({ status: "free", entitlements: { chat: true, collection: true } });
    expect((await runtime.membership.status(bob, "baby-a")).version).toBe((await status()).version);
  });
  it("scheduled start and exact expiry use server time; resume does not erase expiry policy", async () => {
    await configure({ startsAt: "2026-10-23T13:00:00Z", endsAt: "2026-10-23T14:00:00Z", expiryPolicy: { chat: "pause", collection: "pause" } });
    expect(await status()).toMatchObject({ status: "scheduled", entitlements: { chat: false, collection: false } });
    now = Date.parse("2026-10-23T13:00:00Z"); expect((await status()).status).toBe("free");
    now = Date.parse("2026-10-23T14:00:00Z");
    await operations.execute(admin, command({ action: "pause", expectedVersion: (await status()).version }));
    await operations.execute(admin, command({ action: "resume", expectedVersion: (await status()).version }));
    expect(await status()).toMatchObject({ status: "expired", entitlements: { chat: false, collection: false, history: true } });
    await configure();
  });
  it("configuration changes are versioned, conflict-safe, idempotent and audited", async () => {
    const version = (await status()).version, input = command({ action: "pause", expectedVersion: version });
    const result = await operations.execute(admin, input);
    expect(await operations.execute(admin, input)).toEqual(result);
    await expect(operations.execute(admin, { ...input, reason: "相同请求篡改配置理由" })).rejects.toMatchObject({ code: "OPS_REQUEST_REUSED" });
    await expect(operations.execute(admin, command({ action: "resume", expectedVersion: version }))).rejects.toMatchObject({ code: "MEMBERSHIP_VERSION_CONFLICT" });
    const overview = await operations.overview(auditor, "baby-a");
    expect(overview.membership).toMatchObject({ version: version + 1, changes: expect.arrayContaining([expect.objectContaining({ version: version + 1, action: "pause", reason: input.reason })]) });
    expect((await runtime.store.list("audit")).filter(row => row.value.action === "membership.pause" && (row.value.target as { version: number })?.version === version + 1)).toHaveLength(1);
    await operations.execute(admin, command({ action: "resume", expectedVersion: version + 1 }));
  });
  it("two operators changing the same version cannot silently overwrite", async () => {
    const version = (await status()).version;
    const outcomes = await Promise.allSettled([operations.execute(admin, command({ action: "pause", expectedVersion: version })), operations.execute(admin, command({ action: "pause", expectedVersion: version }))]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await status()).version).toBe(version + 1);
    await operations.execute(admin, command({ action: "resume", expectedVersion: version + 1 }));
  });
  it("audit failure rolls back policy and command revision together", async () => {
    const before = await status(), create = runtime.store.payload.create.bind(runtime.store.payload);
    const spy = vi.spyOn(runtime.store.payload, "create").mockImplementation(async options => {
      const data = options.data as { value?: { action?: string } };
      if (options.collection === "audit" && data.value?.action === "membership.pause") throw new Error("injected audit failure");
      return create(options);
    });
    try { await expect(operations.execute(admin, command({ action: "pause", expectedVersion: before.version }))).rejects.toThrow("injected audit failure"); }
    finally { spy.mockRestore(); }
    expect((await status()).version).toBe(before.version); expect((await status()).status).toBe(before.status);
  });
  it("invalid or shorter periods never change state, and service rows reject generic CRUD", async () => {
    const version = (await status()).version;
    await expect(configure({ startsAt: "2026-10-25T00:00:00Z", endsAt: "2026-10-24T00:00:00Z" })).rejects.toThrow();
    await expect(configure({ expiryPolicy: { chat: "pause", collection: "pause" } })).rejects.toThrow();
    await expect(operations.execute(admin, command({ action: "extend", expectedVersion: version, endsAt: "2026-10-24T00:00:00Z" }))).rejects.toMatchObject({ code: "MEMBERSHIP_EXTENSION_INVALID" });
    expect((await status()).version).toBe(version);
    await expect(runtime.store.payload.update({ collection: "service-memberships", id: "baby-a", overrideAccess: false, user: admin, data: { value: {} } })).rejects.toThrow();
    await expect(runtime.store.payload.delete({ collection: "service-memberships", id: "baby-a", overrideAccess: true })).rejects.toThrow();
  });
  it("a damaged stored policy fails closed and is distinct from missing configuration", async () => {
    const value = (await runtime.store.payload.findByID({ collection: "service-memberships", id: "baby-a", overrideAccess: true })).value;
    await runtime.store.transaction(req => runtime.store.payload.update({ collection: "service-memberships", id: "baby-a", overrideAccess: true, req, data: { value: { version: "corrupt" } } }));
    try {
      const response = await runtime.handler(new Request(`${origin}/api/app/membership?babyId=baby-a`, { headers: { Authorization: `Bearer ${token}` } }));
      expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "MEMBERSHIP_UNAVAILABLE", retryable: true });
      await expect(runtime.membership.requireAvailable("baby-a", "chat")).rejects.toMatchObject({ code: "MEMBERSHIP_UNAVAILABLE" });
    } finally { await runtime.store.transaction(req => runtime.store.payload.update({ collection: "service-memberships", id: "baby-a", overrideAccess: true, req, data: { value } })); }
  });
  it("configuration and audit survive reopening the same database", async () => {
    const before = await status();
    const original = await runtime.membership.read(alice, "baby-a");
    await runtime.close(); runtime = await createRuntime(options());
    vi.spyOn(runtime.identity, "now").mockImplementation(() => now);
    alice = await runtime.identity.authenticate(token, "bearer");
    operations = new OperationsService(runtime, runtime.membership);
    expect(await status()).toEqual(before);
    expect(await runtime.membership.read(alice, "baby-a")).toEqual(original);
  });
});
