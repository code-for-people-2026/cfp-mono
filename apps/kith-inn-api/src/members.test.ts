import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../scripts/migrate.mjs";
import { runMemberCommand } from "../scripts/members.mjs";
import { resolveKithInnTestDatabaseUrl } from "./config";
import { createKithInnPool } from "./database";
import { grantMember, revokeMember } from "./members";
import { Sessions, type ActiveSession } from "./sessions";
import { Dishes } from "./dishes";
import { Weeks } from "./weeks";
import { createKithInnHttpServer } from "./http";
import type { WeekWriteInput } from "@cfp/kith-inn-contracts";

const url = resolveKithInnTestDatabaseUrl();
const pool = createKithInnPool({ KITH_INN_DATABASE_URL: url });
const sessions = new Sessions(pool, { appId: "test-app" }, async (code) => code);
const dishes = new Dishes(pool, sessions), weeks = new Weeks(pool, sessions);
const provision = (openid: string, store?: string) => grantMember(pool, { appId: "test-app", openid }, store);
const login = async (openid: string) => sessions.authenticate((await sessions.login(openid)).token);
const batch = (name = "测试荤菜") => ({ items: [{ name, category: "meat" }] });
const weekInput = (dish: string, weekStart = "2026-10-05"): WeekWriteInput => ({
  baseVersion: 0, confirm: true, rebuild: true, structure: { meat: 1, vegetable: 0, soup: 0 },
  meals: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.parse(`${weekStart}T00:00:00Z`) + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10),
    mealType: i % 2 ? "dinner" : "lunch", enabled: true, soupOmitted: false, meat: [dish], vegetable: [], soup: []
  }))
});

describe("authorized members and isolated stores on PostgreSQL", () => {
  beforeAll(async () => { await migrate(pool); });
  beforeEach(async () => { await pool.query("TRUNCATE mutation_receipts, week_plans, dishes, sessions, merchant_members, merchants"); });
  afterAll(async () => { await pool.end(); });

  it("never provisions on login; repeated/concurrent authorized provisioning does not duplicate stores", async () => {
    await expect(sessions.login("visitor")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pool.query("SELECT count(*)::int AS n FROM merchants")).rows[0].n).toBe(0);
    const [one, same, two, three] = await Promise.all([provision("one"), provision("one"), provision("two"), provision("three")]);
    expect(one).toEqual(same);
    expect(new Set([one.merchantId, two.merchantId, three.merchantId]).size).toBe(3);
    const [first, second] = await Promise.all([sessions.login("one"), sessions.login("one")]);
    expect(first.memberId).toBe(second.memberId);
    expect(first.merchantId).toBe(one.merchantId);
    expect(first.token).not.toBe(second.token);
    await expect(provision("one", two.merchantId)).rejects.toThrow("another store");
    expect((await pool.query("SELECT count(*)::int AS n FROM merchants")).rows[0].n).toBe(3);
  });

  it("isolates dishes, same idempotency keys, menu history and generation across three stores", async () => {
    const actors: ActiveSession[] = [];
    const ids: string[] = [], key = randomUUID(), weekKey = randomUUID();
    for (const name of ["one", "two", "three"]) {
      await provision(name); const actor = await login(name); actors.push(actor);
      // All three may use identical names and request IDs without sharing a result.
      ids.push((await dishes.create(actor, key, batch())).body.items[0]!.id);
    }
    expect(new Set(ids).size).toBe(3);
    for (const [i, actor] of actors.entries()) {
      expect((await dishes.list(actor)).items.map((dish) => dish.id)).toEqual([ids[i]]);
      await expect(dishes.update(actor, randomUUID(), ids[(i + 1) % 3]!, {
        baseVersion: 1, name: "伪造修改", category: "meat", active: true
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(dishes.delete(actor, randomUUID(), ids[(i + 1) % 3]!, { baseVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(weeks.save(actor, randomUUID(), "2026-10-05", weekInput(ids[(i + 1) % 3]!)))
        .rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
      await weeks.save(actor, weekKey, "2026-10-05", weekInput(ids[i]!));
      const saved = await weeks.read(actor, "2026-10-05");
      expect(saved.meals.every((meal) => meal.meat[0]!.dishId === ids[i])).toBe(true);
      expect((await weeks.list(actor)).items).toHaveLength(1);
      const generated = await weeks.generate(actor, "2026-10-12", {
        structure: saved.structure, meals: weekInput(ids[i]!, "2026-10-12").meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled }))
      });
      expect(generated.meals.every((meal) => meal.meat[0]!.dishId === ids[i])).toBe(true);
    }
  });

  it("permits explicit same-store cooperation with version conflicts and independent logout/revocation", async () => {
    const owner = await provision("owner"), colleague = await provision("colleague", owner.merchantId);
    const a = await login("owner"), first = await sessions.login("colleague"), second = await sessions.login("colleague");
    const b = await sessions.authenticate(first.token);
    const dish = (await dishes.create(a, randomUUID(), batch())).body.items[0]!;
    expect((await dishes.list(b)).items).toEqual([dish]);
    await dishes.update(a, randomUUID(), dish.id, { baseVersion: 1, name: "修改后", category: "meat", active: true });
    await expect(dishes.update(b, randomUUID(), dish.id, { baseVersion: 1, name: "覆盖", category: "meat", active: true }))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await sessions.revoke(b);
    await expect(sessions.authenticate(first.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const captured = await sessions.authenticate(second.token);
    await revokeMember(pool, colleague.memberId);
    await expect(sessions.authenticate(second.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(sessions.login("colleague")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(dishes.create(captured, randomUUID(), batch("撤权后写入"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await dishes.list(a)).items[0]!.name).toBe("修改后");
    await provision("colleague", owner.merchantId);
    await expect(sessions.authenticate(second.token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(login("colleague")).resolves.toMatchObject({ memberId: colleague.memberId });
  });

  it("checks the session member/store binding even for a forged internal session", async () => {
    await provision("one"); await provision("two");
    const a = await login("one"), b = await login("two");
    await expect(dishes.create({ ...a, merchantId: b.merchantId }, randomUUID(), batch()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(pool.query(`INSERT INTO sessions (token_hash, merchant_id, member_id, expires_at)
      VALUES ($1, $2, $3, now() + interval '1 hour')`, [Buffer.alloc(32), b.merchantId, a.memberId]))
      .rejects.toMatchObject({ code: "23503" });
  });

  it("enforces real HTTP denial and offers no public provisioning endpoint", async () => {
    await provision("one");
    const server = createKithInnHttpServer({ sessions, dishes, weeks, readiness: async () => {} });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No address");
    const origin = `http://127.0.0.1:${address.port}/api/kith-inn`;
    try {
      expect((await fetch(`${origin}/dishes`)).status).toBe(401);
      expect((await fetch(`${origin}/sessions/wechat`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "visitor" }) })).status).toBe(403);
      const session = await sessions.login("one");
      const headers = { authorization: `Bearer ${session.token}` };
      expect((await fetch(`${origin}/members`, { method: "POST", headers })).status).toBe(404);
      await revokeMember(pool, session.memberId);
      expect((await fetch(`${origin}/dishes`, { headers })).status).toBe(401);
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it("requires a verified WeChat code, matching database and explicit target for grants", async () => {
    const exchange = vi.fn(async () => "verified-member");
    const wechat = { appId: "test-app", exchange };
    const database = (await pool.query("SELECT current_database() AS name")).rows[0].name as string;
    await expect(runMemberCommand(pool, { action: "create-store", database: "wrong", code: "fresh" }, wechat)).rejects.toThrow("Wrong database");
    await expect(runMemberCommand(pool, { action: "grant", database, code: "fresh" }, wechat)).rejects.toThrow();
    await expect(runMemberCommand(pool, { action: "create-store", database, code: "fresh", openid: "forged" }, wechat)).rejects.toThrow();
    expect(exchange).not.toHaveBeenCalled();
    const result = await runMemberCommand(pool, { action: "create-store", database, code: "fresh" }, wechat);
    expect(exchange).toHaveBeenCalledWith("fresh");
    expect(JSON.stringify(result)).not.toContain("verified-member");
    await runMemberCommand(pool, { action: "revoke", database, memberId: result.memberId }, wechat);
    await expect(sessions.login("verified-member")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("serves normal requests with runtime grants but cannot create stores or change membership", async () => {
    const owner = await provision("runtime-owner");
    const role = `kith_runtime_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE ROLE ${role} NOLOGIN`);
    const runtime = new Pool({ connectionString: url, options: `-c role=${role}`, max: 2 });
    try {
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await pool.query(`GRANT SELECT, UPDATE ON merchants TO ${role}`);
      await pool.query(`GRANT SELECT ON merchant_members, kith_inn_migrations TO ${role}`);
      await pool.query(`GRANT SELECT, INSERT, UPDATE ON sessions, week_plans TO ${role}`);
      await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON dishes TO ${role}`);
      await pool.query(`GRANT SELECT, INSERT, DELETE ON mutation_receipts TO ${role}`);
      const auth = new Sessions(runtime, { appId: "test-app" }, async (code) => code);
      const dishApi = new Dishes(runtime, auth), weekApi = new Weeks(runtime, auth);
      const token = (await auth.login("runtime-owner")).token, actor = await auth.authenticate(token);
      const dish = (await dishApi.create(actor, randomUUID(), batch())).body.items[0]!;
      expect((await dishApi.list(actor)).items[0]!.id).toBe(dish.id);
      await weekApi.save(actor, randomUUID(), "2026-10-05", weekInput(dish.id));
      expect((await weekApi.list(actor)).items).toHaveLength(1);
      await expect(grantMember(runtime, { appId: "test-app", openid: "new-store" })).rejects.toMatchObject({ code: "42501" });
      await expect(grantMember(runtime, { appId: "test-app", openid: "new-member" }, owner.merchantId)).rejects.toMatchObject({ code: "42501" });
      await expect(revokeMember(runtime, owner.memberId)).rejects.toMatchObject({ code: "42501" });
      await auth.revoke(actor);
      await expect(auth.authenticate(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect((await pool.query("SELECT count(*)::int AS n FROM merchant_members")).rows[0].n).toBe(1);
    } finally {
      await runtime.end();
      await pool.query(`DROP OWNED BY ${role}`);
      await pool.query(`DROP ROLE ${role}`);
    }
  });

  it("upgrades an existing store without replacing identity, sessions, dish/menu snapshots or receipts", async () => {
    const schema = `upgrade_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const old = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 2 });
    const folder = await mkdtemp(join(tmpdir(), "kith-member-migration-"));
    try {
      await writeFile(join(folder, "0001_initial.sql"), await readFile(new URL("../migrations/0001_initial.sql", import.meta.url)));
      await migrate(old, pathToFileURL(`${folder}/`));
      const store = (await old.query("INSERT INTO merchants (app_id, openid) VALUES ('test-app', 'existing') RETURNING id")).rows[0].id;
      const token = "a".repeat(43), hash = createHash("sha256").update(token).digest();
      await old.query("INSERT INTO sessions (merchant_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')", [store, hash]);
      const dish = (await old.query("INSERT INTO dishes (merchant_id, name, category) VALUES ($1, '旧菜品', 'meat') RETURNING id", [store])).rows[0].id;
      const input = weekInput(dish);
      await old.query("INSERT INTO week_plans (merchant_id, week_start, structure, meals) VALUES ($1, '2026-10-05', $2, $3)",
        [store, JSON.stringify(input.structure), JSON.stringify(input.meals)]);
      await old.query(`INSERT INTO mutation_receipts (merchant_id, idempotency_key, request_hash, response_status, response_body)
        VALUES ($1, $2, $3, 201, '{"saved":true}')`, [store, randomUUID(), Buffer.alloc(32)]);
      const tables = ["dishes", "week_plans", "mutation_receipts"];
      const before = await Promise.all(tables.map(async (table) => (await old.query(`SELECT * FROM ${table}`)).rows));
      await migrate(old); await migrate(old);
      expect(await Promise.all(tables.map(async (table) => (await old.query(`SELECT * FROM ${table}`)).rows))).toEqual(before);
      const upgraded = new Sessions(old, { appId: "test-app" }, async () => "existing");
      expect(await upgraded.authenticate(token)).toMatchObject({ merchantId: store });
      expect((await upgraded.login("new-code")).merchantId).toBe(store);
      expect((await old.query("SELECT count(*)::int AS n FROM merchant_members")).rows[0].n).toBe(1);
    } finally { await old.end(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); await rm(folder, { recursive: true, force: true }); }
  });
});
