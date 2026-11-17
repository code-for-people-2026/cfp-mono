import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sqliteAdapter, sql } from "@payloadcms/db-sqlite";
import {
  BasePayload,
  buildConfig,
  type CollectionConfig,
  type Payload,
} from "payload";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdministrator } from "../operations/policy";
import { adminRoleField } from "../operations/collections";
import { installSqliteContentionWait } from "./sqlite-contention";
import {
  FirstAdminUnavailableError,
  guardAdminCreation,
  isFirstAdminRegistrationOpen,
  registerFirstAdmin,
} from "./first-admin";
import { up as latchMigration } from "./migrations/20261117_150000_first_admin_latch";

const routeState = vi.hoisted(() => ({ payload: undefined as Payload | undefined }));
vi.mock("./client", () => ({
  cms: async () => {
    if (!routeState.payload) throw new Error("route test Payload is not configured");
    return routeState.payload;
  },
}));

import { GET, POST } from "../app/api/first-admin/route";

let failAfterAdminCreation = false;

const admins: CollectionConfig = {
  slug: "admins",
  auth: true,
  access: { create: ({ req }) => isAdministrator(req.user) || req.context.helloFirstAdminRegistration === true },
  hooks: {
    beforeChange: [guardAdminCreation],
    afterChange: [async ({ doc }) => {
      if (failAfterAdminCreation) throw new Error(`failed after creating ${doc.email}`);
      return doc;
    }],
  },
  fields: [adminRoleField],
};
const latch: CollectionConfig = {
  slug: "admin-initializations",
  timestamps: false,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [{ name: "key", type: "text", required: true, unique: true }],
};

const payloads: Payload[] = [];
const directories: string[] = [];

async function setup(database?: string) {
  const directory = database ? path.dirname(database) : await mkdtemp(path.join(tmpdir(), "hello-first-admin-"));
  if (!database) directories.push(directory);
  const file = database || path.join(directory, "test.db");
  const payload = await new BasePayload().init({
    config: buildConfig({
      secret: "isolated-first-admin-test-secret",
      telemetry: false,
      onInit: installSqliteContentionWait,
      db: sqliteAdapter({ client: { url: `file:${file}` }, push: false, transactionOptions: {} }),
      collections: [admins, latch],
    }),
  });
  payloads.push(payload);
  if (!database) {
    const db = payload.db.drizzle;
    await db.run(sql`CREATE TABLE admins (
      id integer PRIMARY KEY NOT NULL,
      role text DEFAULT 'reviewer' NOT NULL,
      updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
      email text NOT NULL, reset_password_token text, reset_password_expiration text,
      salt text, hash text, login_attempts numeric DEFAULT 0, lock_until text
    )`);
    await db.run(sql`CREATE UNIQUE INDEX admins_email_idx ON admins (email)`);
    await db.run(sql`CREATE TABLE admins_sessions (
      _order integer NOT NULL, _parent_id integer NOT NULL,
      id text PRIMARY KEY NOT NULL, created_at text, expires_at text NOT NULL,
      FOREIGN KEY (_parent_id) REFERENCES admins(id) ON DELETE cascade
    )`);
    await db.run(sql`CREATE INDEX admins_sessions_order_idx ON admins_sessions (_order)`);
    await db.run(sql`CREATE INDEX admins_sessions_parent_id_idx ON admins_sessions (_parent_id)`);
    await latchMigration({ db, payload, req: {} as never });
  }
  return { payload, database: file };
}

afterEach(async () => {
  routeState.payload = undefined;
  failAfterAdminCreation = false;
  await Promise.all(payloads.splice(0).map((payload) => payload.destroy()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const valid = (email = "first@example.invalid") => ({
  email,
  password: "a-secure-password-123",
  confirmPassword: "a-secure-password-123",
});

describe("first administrator registration", () => {
  it("creates the only initial administrator and permanently closes registration", async () => {
    const { payload } = await setup();
    expect(await isFirstAdminRegistrationOpen(payload)).toBe(true);
    await registerFirstAdmin(payload, valid());
    expect(await payload.count({ collection: "admins", overrideAccess: true })).toMatchObject({ totalDocs: 1 });
    expect(await isFirstAdminRegistrationOpen(payload)).toBe(false);
    await expect(registerFirstAdmin(payload, valid("second@example.invalid"))).rejects.toBeInstanceOf(FirstAdminUnavailableError);
    // Simulate a future administrative/database deletion without removing the latch.
    await payload.db.drizzle.run(sql`DELETE FROM admins`);
    expect(await isFirstAdminRegistrationOpen(payload)).toBe(false);
  });

  it("allows only one winner across two independent Payload instances and connections", async () => {
    const first = await setup();
    const second = await setup(first.database);
    const results = await Promise.allSettled([
      registerFirstAdmin(first.payload, valid("race-one@example.invalid")),
      registerFirstAdmin(second.payload, valid("race-two@example.invalid")),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await first.payload.count({ collection: "admins", overrideAccess: true })).toMatchObject({ totalDocs: 1 });
  });

  it.each([
    { ...valid(), email: "not-an-email" },
    { ...valid(), password: "too-short", confirmPassword: "too-short" },
    { ...valid(), confirmPassword: "different-password" },
  ])("rejects invalid registration input", async (input) => {
    const { payload } = await setup();
    await expect(registerFirstAdmin(payload, input)).rejects.toBeDefined();
    expect(await payload.count({ collection: "admins", overrideAccess: true })).toMatchObject({ totalDocs: 0 });
  });

  it("rejects Payload native first-register style creation without guarded context", async () => {
    const { payload } = await setup();
    await expect(payload.create({
      collection: "admins",
      overrideAccess: true,
      data: { email: "native@example.invalid", password: "native-password-123", role: "administrator" },
    })).rejects.toThrow("管理员注册未开放");
  });

  it.each(["helloFirstAdminRegistration", "helloAdminBootstrap"] as const)(
    "requires a transaction for the trusted %s path",
    async (contextKey) => {
      await expect(guardAdminCreation({
        operation: "create",
        data: {},
        req: {
          context: { [contextKey]: true },
          transactionID: undefined,
        },
      } as never)).rejects.toThrow("管理员初始化需要数据库事务");
    },
  );

  it("rolls back the latch when admin creation fails after change and allows retry", async () => {
    const { payload } = await setup();
    failAfterAdminCreation = true;
    await expect(registerFirstAdmin(payload, valid("rollback@example.invalid")))
      .rejects.toThrow("failed after creating rollback@example.invalid");
    expect(await payload.count({ collection: "admins", overrideAccess: true }))
      .toMatchObject({ totalDocs: 0 });
    expect(await payload.count({ collection: "admin-initializations", overrideAccess: true }))
      .toMatchObject({ totalDocs: 0 });

    failAfterAdminCreation = false;
    await expect(registerFirstAdmin(payload, valid("rollback@example.invalid")))
      .resolves.toMatchObject({ email: "rollback@example.invalid" });
  });

  it("rejects legacy bootstrap after the initial administrator was deleted", async () => {
    const { payload } = await setup();
    await payload.create({
      collection: "admins",
      overrideAccess: true,
      context: { helloAdminBootstrap: true },
      data: { email: "legacy-first@example.invalid", password: "legacy-password-123", role: "reviewer" },
    });
    await payload.db.drizzle.run(sql`DELETE FROM admins`);
    await expect(payload.create({
      collection: "admins",
      overrideAccess: true,
      context: { helloAdminBootstrap: true },
      data: { email: "legacy-second@example.invalid", password: "legacy-password-123", role: "reviewer" },
    })).rejects.toThrow("管理员初始化已关闭");
  });

  it("serves GET and validates malformed and invalid POST requests through the route handlers", async () => {
    const { payload } = await setup();
    routeState.payload = payload;
    expect(await (await GET()).json()).toEqual({ open: true });
    const request = (body: string) => new Request("http://localhost/api/first-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect((await POST(request("{"))).status).toBe(400);
    const invalid = await POST(request(JSON.stringify({ ...valid(), email: "invalid" })));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "请输入有效的邮箱地址" });
  });

  it("creates once and returns closure from the actual GET and POST route handlers", async () => {
    const { payload } = await setup();
    routeState.payload = payload;
    const request = (email: string) => new Request("http://localhost/api/first-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(valid(email)),
    });
    expect((await POST(request("public@example.invalid"))).status).toBe(201);
    expect((await GET()).status).toBe(404);
    expect((await POST(request("bypass@example.invalid"))).status).toBe(404);
  });

  it("does not change normal authorized administrator creation", async () => {
    const { payload } = await setup();
    const first = await registerFirstAdmin(payload, valid());
    await expect(payload.create({
      collection: "admins",
      overrideAccess: false,
      user: { ...first, collection: "admins" },
      data: { email: "authorized@example.invalid", password: "authorized-password-123", role: "reviewer" },
    })).resolves.toMatchObject({ email: "authorized@example.invalid", role: "reviewer" });
  });
});
