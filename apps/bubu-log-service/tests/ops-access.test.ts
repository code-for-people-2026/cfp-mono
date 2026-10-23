import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPayload, type Payload } from "payload";
import { sql } from "@payloadcms/db-sqlite";
import { buildRuntimeConfig } from "../src/runtime-config";
import { bootstrapOpsAdmin } from "../src/operations/collections";
import { readOpsUser, requireBaby } from "../src/operations/access";
import { serializeDatabaseTransactions } from "../src/database-queue";
import { appendOpsAudit } from "../src/operations/audit";

describe("Payload operations authentication and scoped native collections", () => {
  let directory: string;
  let payload: Payload;
  let administrator: { id: number | string; collection: "ops-users" };
  const password = "fixture-only-password-012345";
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bubu-ops-access-"));
    const config = await buildRuntimeConfig({ directory, secret: "fixture-ops-no-real-families-or-credentials", origin: "http://127.0.0.1:3320" });
    payload = await getPayload({ config, key: `ops-${randomUUID()}` });
    serializeDatabaseTransactions(payload);
    await expect(payload.create({ collection: "ops-users", data: { email: "anonymous@fixture.invalid", password, role: "administrator", active: true }, overrideAccess: true })).rejects.toThrow("运营账号只能");
    const admin = await bootstrapOpsAdmin(payload, { email: "admin@fixture.invalid", password, babyIds: ["baby-a"] });
    administrator = { id: admin.id, collection: "ops-users" };
  });
  afterAll(async () => { await payload?.destroy(); await rm(directory, { recursive: true, force: true }); });
  const createUser = async (role: "administrator" | "operator" | "auditor", babyIds = ["baby-a"]) => {
    const email = `${randomUUID()}@fixture.invalid`;
    const doc = await payload.create({ collection: "ops-users", data: { email, password, role, active: true, babyIds }, overrideAccess: false, user: administrator });
    return { ...doc, email, collection: "ops-users" as const };
  };
  it("marks production and HTTPS operator cookies Secure while allowing isolated HTTP development", async () => {
    const cookieSecure = async (origin: string) => {
      const config = await buildRuntimeConfig({ directory: ".", secret: "schema-only-cookie-verification-secret", origin, schemaOnly: true });
      const auth = config.collections.find(collection => collection.slug === "ops-users")?.auth;
      return auth && typeof auth === "object" ? auth.cookies.secure : undefined;
    };
    expect(await cookieSecure("http://127.0.0.1:3320")).toBe(false);
    expect(await cookieSecure("https://ops.fixture.invalid")).toBe(true);
    try {
      vi.stubEnv("NODE_ENV", "production");
      expect(await cookieSecure("http://127.0.0.1:3320")).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
  it("blocks ordinary registration and Payload first-register overrideAccess bypass", async () => {
    const data = { email: "intruder@fixture.invalid", password, role: "administrator", active: true, babyIds: ["baby-a"] };
    await expect(payload.create({ collection: "ops-users", data, overrideAccess: false })).rejects.toThrow();
    await expect(payload.create({ collection: "ops-users", data, overrideAccess: true })).rejects.toThrow("运营账号只能");
    await expect(bootstrapOpsAdmin(payload, { email: "another@fixture.invalid", password, babyIds: [] })).rejects.toThrow("初始化只能");
    await expect(payload.create({ collection: "users", data: { email: "old@fixture.invalid", password }, overrideAccess: true })).rejects.toThrow("入口已关闭");
    await expect(payload.forgotPassword({ collection: "ops-users", data: { email: "admin@fixture.invalid" } })).rejects.toThrow("联系管理员");
    await expect(payload.forgotPassword({ collection: "users", data: { email: "old@fixture.invalid" } })).rejects.toThrow("入口已关闭");
  });
  it("logs in ops accounts, returns no password/hash/session internals, and denies family and collector principals", async () => {
    const login = await payload.login({ collection: "ops-users", data: { email: "admin@fixture.invalid", password } });
    expect(login.user?.id).toBe(administrator.id); expect(login.token).toBeUndefined();
    expect(payload.collections["ops-users"]?.config.admin.hidden).not.toBe(true);
    const publicDoc = await payload.findByID({ collection: "ops-users", id: administrator.id, overrideAccess: false, user: administrator, showHiddenFields: true });
    for (const name of ["hash", "salt", "password", "sessions", "resetPasswordToken"]) { expect(publicDoc).not.toHaveProperty(name); expect(login.user).not.toHaveProperty(name); }
    await expect(readOpsUser(payload, { ...administrator, collection: "identities" })).rejects.toMatchObject({ status: 403 });
    await expect(readOpsUser(payload, { kind: "collector", id: administrator.id })).rejects.toMatchObject({ status: 403 });
  });
  it("requires fresh enabled role and explicit baby scope even for administrators", async () => {
    const operator = await createUser("operator");
    const user = await readOpsUser(payload, operator);
    expect(() => requireBaby(user, "baby-a", true)).not.toThrow();
    expect(() => requireBaby(user, "baby-b")).toThrow();
    const admin = await readOpsUser(payload, { ...administrator, id: String(administrator.id) });
    expect(() => requireBaby(admin, "baby-b")).toThrow();
    const auditor = await readOpsUser(payload, await createUser("auditor"));
    expect(() => requireBaby(auditor, "baby-a", true)).toThrow();
    await payload.update({ collection: "ops-users", id: operator.id, data: { active: false }, user: administrator, overrideAccess: false });
    await expect(readOpsUser(payload, operator)).rejects.toMatchObject({ status: 403 });
    await expect(payload.login({ collection: "ops-users", data: { email: operator.email, password } })).rejects.toThrow();
  });
  it("does not permit operators to list other accounts, expand scope, or manage accounts", async () => {
    const operator = await createUser("operator");
    const list = await payload.find({ collection: "ops-users", user: operator, overrideAccess: false });
    expect(list.docs.map(doc => doc.id)).toEqual([operator.id]);
    await expect(payload.update({ collection: "ops-users", id: operator.id, data: { babyIds: ["baby-b"], role: "administrator" }, user: operator, overrideAccess: false })).rejects.toThrow();
    await expect(payload.create({ collection: "ops-users", data: { email: "new@fixture.invalid", password }, user: operator, overrideAccess: false })).rejects.toThrow();
  });
  it("exposes scoped native read-only projections, keeps raw internal data and audits sensitive reads", async () => {
    const operator = await createUser("operator");
    for (const babyId of ["baby-a", "baby-b"]) await payload.create({ collection: "care-events", data: { id: babyId, key: `internal-${babyId}`, babyId, value: { id: babyId, facts: { type: "BOTTLE", milkAmount: 120 }, actor: { id: "caregiver", sessionId: "must-never-leak" }, token: "secret-token" } }, overrideAccess: true });
    const native = await payload.find({ collection: "care-events", user: operator, overrideAccess: false, showHiddenFields: true });
    expect(native.docs).toHaveLength(1); expect(native.docs[0]?.babyId).toBe("baby-a");
    expect(native.docs[0]).not.toHaveProperty("key"); expect(native.docs[0]).not.toHaveProperty("value");
    expect(native.docs[0]?.details).toMatchObject({ type: "BOTTLE" });
    expect(native.docs[0]?.details).not.toHaveProperty("facts"); expect(native.docs[0]?.details).not.toHaveProperty("actor");
    expect(JSON.stringify(native.docs)).not.toContain("must-never-leak"); expect(JSON.stringify(native.docs)).not.toContain("secret-token");
    await expect(payload.findByID({ collection: "care-events", id: "baby-b", user: operator, overrideAccess: false })).rejects.toThrow();
    await expect(payload.update({ collection: "care-events", id: "baby-a", data: { value: {} }, user: administrator, overrideAccess: false })).rejects.toThrow();
    const internal = await payload.findByID({ collection: "care-events", id: "baby-a", overrideAccess: true });
    expect(internal.value.actor.sessionId).toBe("must-never-leak");
    await payload.create({ collection: "care-events", data: { id: "baby-a-second", key: "second", babyId: "baby-a", value: { id: "second", status: "done" } }, overrideAccess: true });
    expect((await payload.find({ collection: "care-events", user: operator, overrideAccess: false })).docs).toHaveLength(2);
    const audit = await payload.find({ collection: "audit", overrideAccess: true, pagination: false, limit: 0 });
    expect(audit.docs.some(doc => doc.value.action === "ops.metadata.read" && doc.value.babyId === "baby-a")).toBe(true);
  });
  it("keeps hidden identities, sessions, bindings, chat and ops receipts inaccessible to generic APIs", async () => {
    for (const collection of ["identities", "sessions", "grants", "invitations", "group-bindings", "audit", "chat-turns", "ops-requests"]) await expect(payload.find({ collection, user: administrator, overrideAccess: false })).rejects.toThrow();
    await expect(payload.find({ collection: "care-events", user: { id: "family", collection: "identities" }, overrideAccess: false })).rejects.toThrow();
  });
  it("preserves the last administrator on deletion, disabling and downgrade", async () => {
    await expect(payload.delete({ collection: "ops-users", id: administrator.id, user: administrator, overrideAccess: false })).rejects.toThrow("最后一位");
    await expect(payload.update({ collection: "ops-users", id: administrator.id, data: { active: false }, user: administrator, overrideAccess: false })).rejects.toThrow("最后一位");
    await expect(payload.update({ collection: "ops-users", id: administrator.id, data: { role: "operator" }, user: administrator, overrideAccess: false })).rejects.toThrow("最后一位");
    const db = payload.db as unknown as { drizzle: { run: (query: ReturnType<typeof sql>) => Promise<unknown> } };
    await expect(db.drizzle.run(sql`UPDATE ops_users SET active = 0 WHERE id = ${administrator.id}`)).rejects.toThrow();
    const second = await createUser("administrator");
    const results = await Promise.allSettled([payload.update({ collection: "ops-users", id: administrator.id, data: { role: "operator" }, user: second, overrideAccess: false }), payload.delete({ collection: "ops-users", id: second.id, user: administrator, overrideAccess: false })]);
    expect(results.some(result => result.status === "rejected")).toBe(true);
    const remaining = await payload.count({ collection: "ops-users", where: { and: [{ role: { equals: "administrator" } }, { active: { equals: true } }] }, overrideAccess: true });
    expect(remaining.totalDocs).toBe(1);
  });
  it("redacts sensitive audit values before they are persisted", async () => {
    await appendOpsAudit(payload, { actorId: administrator.id, babyId: "baby-a", action: "fixture.action", reason: "fixture", result: { status: "done", token: "never-persist", nested: { sessionId: "secret-session", count: 2 } } });
    const rows = await payload.find({ collection: "audit", overrideAccess: true, pagination: false, limit: 0 });
    const row = rows.docs.find(doc => doc.value.action === "fixture.action");
    expect(row?.value.result).toEqual({ status: "done", nested: { count: 2 } });
  });
});
