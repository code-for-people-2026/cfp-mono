import { randomUUID } from "node:crypto";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DishBatchResultSchema, DishListSchema, DishSchema, ErrorResponseSchema } from "@cfp/kith-inn-contracts";
import { migrate } from "../scripts/migrate.mjs";
import { resolveKithInnTestDatabaseUrl } from "./config";
import { createKithInnPool } from "./database";
import { Dishes } from "./dishes";
import { createKithInnHttpServer } from "./http";
import { Sessions, type ActiveSession } from "./sessions";

describe("PostgreSQL dish mutations and HTTP", () => {
  const pool = createKithInnPool({ KITH_INN_DATABASE_URL: resolveKithInnTestDatabaseUrl() });
  let now: Date, session: ActiveSession, token: string;
  const sessions = new Sessions(pool, { appId: "app", ownerOpenId: "owner" }, async () => "owner", () => now);
  const dishes = new Dishes(pool, sessions, () => now);
  const batch = (name: string) => ({ items: [{ name, category: "meat" }] });
  const add = (name: string, key = randomUUID()) => dishes.create(session, key, batch(name));
  const update = (name: string, baseVersion = 1) => ({ name, category: "meat", active: true, baseVersion });
  const count = async (table: "dishes" | "mutation_receipts") =>
    (await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
  beforeAll(async () => {
    const { rows: [target] } = await pool.query("SELECT current_database() AS name");
    if (!target.name.endsWith("_test")) throw new Error("Test database required");
    await migrate(pool);
  });
  beforeEach(async () => {
    now = new Date();
    await pool.query("TRUNCATE mutation_receipts, week_plans, dishes, sessions, merchants");
    token = (await sessions.login("code")).token;
    session = await sessions.authenticate(token);
  });
  afterAll(async () => { await pool.end(); });

  it("replays concurrent writes and lost responses across devices before checking current state", async () => {
    const key = randomUUID();
    const another = await sessions.authenticate((await sessions.login("other-device")).token);
    const [first, second] = await Promise.all([add("红烧肉", key), dishes.create(another, key.toUpperCase(), batch("红烧肉"))]);
    expect(second).toEqual(first);
    expect(await count("dishes")).toBe(1);
    expect(await count("mutation_receipts")).toBe(1);
    const dish = first.body.items[0]!;
    const patchKey = randomUUID(), changed = update("焖肉");
    const saved = await dishes.update(session, patchKey, dish.id, changed);
    await dishes.update(session, randomUUID(), dish.id, update("炖肉", 2));
    expect(await dishes.update(another, patchKey.toUpperCase(), dish.id.toUpperCase(), changed)).toEqual(saved);
    expect(await add("红烧肉", key)).toEqual(first);
    await expect(add("蒸鱼", key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(dishes.update(session, key, dish.id, update("红烧肉"))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rejects batch and inactive-name duplicates atomically without occupying failed keys", async () => {
    const key = randomUUID();
    await expect(dishes.create(session, key, { items: [...batch("肉").items, ...batch("肉").items] }))
      .rejects.toMatchObject({ code: "DUPLICATE_DISH_NAME", details: { names: ["肉"] } });
    expect(await count("dishes")).toBe(0);
    expect(await count("mutation_receipts")).toBe(0);
    const dish = (await add("肉", key)).body.items[0]!;
    await dishes.update(session, randomUUID(), dish.id, { ...update("肉"), active: false });
    await expect(dishes.create(session, randomUUID(), { items: [...batch("鱼").items, ...batch("肉").items] }))
      .rejects.toMatchObject({ details: { names: ["肉"] } });
    expect((await dishes.list(session)).items).toHaveLength(1);
    expect((await dishes.list(session)).items[0]?.active).toBe(false);
    const other = (await add("鱼")).body.items[0]!;
    await expect(dishes.update(session, randomUUID(), other.id, update("肉")))
      .rejects.toMatchObject({ code: "DUPLICATE_DISH_NAME", details: { names: ["肉"] } });
  });

  it("rejects one of two stale concurrent updates and preserves saved snapshots", async () => {
    const dish = (await add("原菜名")).body.items[0]!;
    const snapshot = Array.from({ length: 14 }, () => ({ meat: [{ dishId: dish.id, name: dish.name }] }));
    await pool.query(`INSERT INTO week_plans (merchant_id, week_start, structure, meals)
      VALUES ($1, '2026-09-21', '{"meat":1,"vegetable":0,"soup":0}', $2)`, [session.merchantId, JSON.stringify(snapshot)]);
    const results = await Promise.allSettled([
      dishes.update(session, randomUUID(), dish.id, { ...update("新名一"), category: "soup", active: false }),
      dishes.update(session, randomUUID(), dish.id, update("新名二"))
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "VERSION_CONFLICT", details: { currentVersion: 2 } }
    });
    expect((await pool.query("SELECT meals FROM week_plans")).rows[0].meals).toEqual(snapshot);
    await expect(dishes.update(session, randomUUID(), randomUUID(), update("不存在")))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("expires receipts at 24 hours while retaining version and name protection", async () => {
    const dish = (await add("肉")).body.items[0]!;
    const key = randomUUID();
    await dishes.update(session, key, dish.id, update("新肉"));
    now = new Date(now.getTime() + 86_400_000);
    await expect(dishes.update(session, key, dish.id, update("新肉")))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 2 } });
    const result = await dishes.update(session, key, dish.id, update("再改名", 2));
    expect(result.body.version).toBe(3);
    const receipt = (await pool.query("SELECT created_at, expires_at FROM mutation_receipts WHERE idempotency_key = $1", [key])).rows[0];
    expect(receipt.created_at).toEqual(now);
    expect(receipt.expires_at.getTime() - now.getTime()).toBe(86_400_000);
  });

  it("deletes by version, replays the receipt, and permits a new dish with the same name", async () => {
    const dish = (await add("误加菜")).body.items[0]!, key = randomUUID();
    await expect(dishes.delete(session, key, dish.id, { baseVersion: 2 })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(dishes.delete(session, key, dish.id, { baseVersion: 1, merchantId: session.merchantId })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(dishes.delete({ ...session, merchantId: randomUUID() }, key, dish.id, { baseVersion: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const deleted = await dishes.delete(session, key, dish.id, { baseVersion: 1 });
    expect(deleted).toEqual({ status: 200, body: { id: dish.id } });
    expect((await dishes.list(session)).items).toEqual([]);
    const replacement = (await add("误加菜")).body.items[0]!;
    expect(replacement.id).not.toBe(dish.id);
    expect(await dishes.delete(session, key.toUpperCase(), dish.id.toUpperCase(), { baseVersion: 1 })).toEqual(deleted);
    expect((await dishes.list(session)).items).toEqual([replacement]);
    await expect(dishes.delete(session, randomUUID(), dish.id, { baseVersion: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(dishes.delete(session, key, replacement.id, { baseVersion: 1 })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("rolls back deletion when its success receipt cannot be stored", async () => {
    const dish = (await add("保留菜")).body.items[0]!;
    await pool.query(`CREATE FUNCTION reject_delete_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;
      CREATE TRIGGER reject_delete_receipt BEFORE INSERT ON mutation_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_delete_receipt()`);
    try {
      await expect(dishes.delete(session, randomUUID(), dish.id, { baseVersion: 1 })).rejects.toMatchObject({ code: "P0001" });
      expect((await dishes.list(session)).items).toEqual([dish]);
    } finally { await pool.query("DROP TRIGGER reject_delete_receipt ON mutation_receipts; DROP FUNCTION reject_delete_receipt()"); }
  });

  it("cleans old receipts on a new UUID while live receipts still replay", async () => {
    await add("旧菜");
    now = new Date(now.getTime() + 1);
    const liveKey = randomUUID(), live = await add("保留菜", liveKey);
    now = new Date(now.getTime() + 86_400_000 - 1);
    await expect(add("保留菜")).rejects.toMatchObject({ code: "DUPLICATE_DISH_NAME" });
    expect(await count("mutation_receipts")).toBe(2); // Failed mutations roll cleanup back too.
    await add("新菜");
    expect(await count("mutation_receipts")).toBe(2);
    expect(await add("保留菜", liveKey)).toEqual(live);
    expect(await count("dishes")).toBe(3);
  });

  it("rolls back dish inserts when writing the success receipt fails", async () => {
    await pool.query(`CREATE FUNCTION reject_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;
      CREATE TRIGGER reject_test_receipt BEFORE INSERT ON mutation_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_test_receipt()`);
    try {
      await expect(add("肉")).rejects.toMatchObject({ code: "P0001" });
      expect(await count("dishes")).toBe(0);
      expect(await count("mutation_receipts")).toBe(0);
    } finally {
      await pool.query("DROP TRIGGER reject_test_receipt ON mutation_receipts; DROP FUNCTION reject_test_receipt()");
    }
  });

  it("rechecks revocation, account status and expiry after acquiring the merchant lock", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM merchants WHERE id = $1 FOR UPDATE", [session.merchantId]);
      const pending = add("肉");
      await client.query("UPDATE sessions SET revoked_at = now()");
      await client.query("COMMIT");
      await expect(pending).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally { client.release(); }
    await pool.query("UPDATE sessions SET revoked_at = NULL");
    await pool.query("UPDATE merchants SET active = false");
    await expect(add("肉")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query("UPDATE merchants SET active = true");
    now = new Date(now.getTime() + 31 * 86_400_000);
    await expect(add("肉")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await count("mutation_receipts")).toBe(0);
  });

  it("enforces 200 per batch and 1000 total including inactive dishes", async () => {
    await expect(dishes.create(session, randomUUID(), { items: Array.from({ length: 201 }, (_, i) => batch(`菜${i}`).items[0]) }))
      .rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { field: "items" } });
    await pool.query(`INSERT INTO dishes (merchant_id, name, category, active)
      SELECT $1, '菜' || n, 'vegetable', false FROM generate_series(1, 1000) n`, [session.merchantId]);
    await expect(add("肉")).rejects.toMatchObject({ code: "LIMIT_EXCEEDED", details: { field: "dishes" } });
    expect(await count("mutation_receipts")).toBe(0);
  });

  it("serves authenticated contract responses and rejects malformed HTTP writes without logging their data", async () => {
    const logger = vi.fn();
    const server = createKithInnHttpServer({ sessions, dishes, logger, readiness: async () => {} });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port, base = `http://127.0.0.1:${port}/api/kith-inn/dishes`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() };
    try {
      expect((await fetch(base)).status).toBe(401);
      const saved = await fetch(base, { method: "POST", headers, body: JSON.stringify(batch("私密菜名")) });
      expect(saved.status).toBe(201);
      const dish = DishBatchResultSchema.parse(await saved.json()).items[0]!;
      const list = await fetch(base, { headers });
      expect(DishListSchema.parse(await list.json()).items[0]).toEqual(dish);
      const changed = await fetch(`${base}/${dish.id}`, { method: "PATCH", headers: { ...headers, "idempotency-key": randomUUID() },
        body: JSON.stringify(update("新菜名")) });
      expect(DishSchema.parse(await changed.json()).version).toBe(2);
      const stale = await fetch(`${base}/${dish.id}`, { method: "PATCH",
        headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify(update("旧设备修改")) });
      expect(stale.status).toBe(409);
      expect(ErrorResponseSchema.parse(await stale.json()).error).toMatchObject({
        code: "VERSION_CONFLICT", details: { currentVersion: 2 }
      });
      const duplicate = await fetch(base, { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() },
        body: JSON.stringify(batch("新菜名")) });
      expect(ErrorResponseSchema.parse(await duplicate.json()).error).toMatchObject({
        code: "DUPLICATE_DISH_NAME", details: { names: ["新菜名"] }
      });
      const deletion = { method: "DELETE", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify({ baseVersion: 2 }) };
      expect((await fetch(`${base}/${dish.id}`, { ...deletion, headers: { "content-type": "application/json" } })).status).toBe(401);
      expect((await fetch(`${base}/${dish.id}`, { ...deletion, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } })).status).toBe(400);
      const deleted = await fetch(`${base}/${dish.id}`, deletion);
      expect(deleted.status).toBe(200); expect(await deleted.json()).toEqual({ id: dish.id });
      expect(await (await fetch(`${base}/${dish.id}`, deletion)).json()).toEqual({ id: dish.id });
      expect((await fetch(base, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(batch("无请求标识")) })).status).toBe(400);
      for (const [url, body] of [[base, { items: [{ name: "菜", category: "invalid" }] }], [base, { ...batch("菜"), merchantId: "forged" }],
        [`${base}?x=1&x=2`, batch("菜")], [`${base}/not-a-uuid`, update("菜")]]) {
        const response = await fetch(String(url), { method: String(url).includes("not-a-uuid") ? "PATCH" : "POST", headers,
          body: JSON.stringify(body) });
        expect(response.status).toBe(400);
        expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe("INVALID_REQUEST");
      }
      const duplicateHeaderStatus = await new Promise<number>((resolve, reject) => {
        const req = request(base, { method: "POST", headers: { ...headers, "idempotency-key": [randomUUID(), randomUUID()] } },
          (res) => { res.resume(); resolve(res.statusCode!); });
        req.on("error", reject); req.end(JSON.stringify(batch("菜")));
      });
      expect(duplicateHeaderStatus).toBe(400);
      expect(JSON.stringify(logger.mock.calls)).not.toMatch(new RegExp(`私密菜名|新菜名|${dish.id}|${token}`));
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
