import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MenuPreviewSchema, WeekListSchema, WeekPlanSchema, type WeekPlan, type WeekWriteInput } from "@cfp/kith-inn-contracts";
import { migrate } from "../scripts/migrate.mjs";
import { resolveKithInnTestDatabaseUrl } from "./config";
import { createKithInnPool } from "./database";
import { Dishes } from "./dishes";
import { Weeks } from "./weeks";
import { createKithInnHttpServer } from "./http";
import { Sessions, type ActiveSession } from "./sessions";

const monday = "2026-09-21";
function input(week: WeekPlan): WeekWriteInput {
  return { baseVersion: week.version, rebuild: false, confirm: false, structure: week.structure,
    meals: week.meals.map((meal) => ({ ...meal, meat: meal.meat.map((d) => d.dishId),
      vegetable: meal.vegetable.map((d) => d.dishId), soup: meal.soup.map((d) => d.dishId) })) };
}
describe("PostgreSQL week snapshots and HTTP", () => {
  const pool = createKithInnPool({ KITH_INN_DATABASE_URL: resolveKithInnTestDatabaseUrl() });
  let now: Date, session: ActiveSession, token: string, meat: string, otherMeat: string, soup: string;
  const sessions = new Sessions(pool, { appId: "app", ownerOpenId: "owner" }, async () => "owner", () => now);
  const dishes = new Dishes(pool, sessions, () => now), weeks = new Weeks(pool, sessions, () => now);
  const initial = (weekStart = monday): WeekWriteInput => ({ baseVersion: 0, rebuild: true, confirm: false,
    structure: { meat: 1, vegetable: 0, soup: 1 }, meals: Array.from({ length: 14 }, (_, i) => ({
      date: new Date(Date.parse(`${weekStart}T00:00:00Z`) + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10),
      mealType: i % 2 ? "dinner" : "lunch", enabled: true, soupOmitted: false, meat: [meat], vegetable: [], soup: [soup]
    })) });
  const save = (data = initial(), key = randomUUID(), weekStart = monday) => weeks.save(session, key, weekStart, data);
  const change = (id: string, name: string, category = "meat", active = true) =>
    dishes.update(session, randomUUID(), id, { baseVersion: 1, name, category, active });
  beforeAll(async () => {
    if (!(await pool.query("SELECT current_database() AS name")).rows[0].name.endsWith("_test")) throw new Error("Test database required");
    await migrate(pool);
  });
  beforeEach(async () => {
    now = new Date();
    await pool.query("TRUNCATE mutation_receipts, week_plans, dishes, sessions, merchants");
    token = (await sessions.login("code")).token; session = await sessions.authenticate(token);
    const result = await dishes.create(session, randomUUID(), { items: [
      { name: "红烧肉", category: "meat" }, { name: "清蒸鱼", category: "meat" }, { name: "蛋花汤", category: "soup" }
    ] });
    [meat, otherMeat, soup] = result.body.items.map((dish) => dish.id) as [string, string, string];
  });
  afterAll(async () => { await pool.end(); });

  it("generates previews without writes and atomically refuses all shortages", async () => {
    const data = initial(), before = await pool.query("SELECT count(*) FROM mutation_receipts");
    const generate = { structure: data.structure, meals: data.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) };
    const preview = await weeks.generate(session, monday, generate);
    expect(MenuPreviewSchema.parse(preview).meals).toHaveLength(14);
    expect((await weeks.list(session)).items).toEqual([]);
    expect((await pool.query("SELECT count(*) FROM mutation_receipts")).rows).toEqual(before.rows);
    await expect(weeks.generate(session, monday, { ...generate, structure: { meat: 3, vegetable: 1, soup: 1 } }))
      .rejects.toMatchObject({ status: 422, details: { shortages: [
        { category: "meat", required: 3, available: 2 }, { category: "vegetable", required: 1, available: 0 }
      ] } });
    await expect(weeks.generate(session, "2026-09-28", generate)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(weeks.generate(session, monday, {})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("serializes first saves and stale edits, while replaying lost responses before version checks", async () => {
    const key = randomUUID(), data = initial();
    const another = await sessions.authenticate((await sessions.login("device-two")).token);
    const [first, replay] = await Promise.all([save(data, key), weeks.save(another, key, monday, data)]);
    expect(replay).toEqual(first);
    expect(first.body.version).toBe(1);
    await expect(save()).rejects.toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 1 } });
    const draft = input(first.body); draft.meals[0]!.soupOmitted = true;
    const changes = await Promise.allSettled([save(draft), save({ ...draft, confirm: true })]);
    expect(changes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(changes.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT", details: { currentVersion: 2 } } });
    expect(await weeks.save(another, key, monday, data)).toEqual(first);
    await expect(save({ ...data, confirm: true }, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect((await weeks.read(session, monday)).version).toBe(2);
    await expect(save({ ...data, baseVersion: 5 }, randomUUID(), "2026-09-28")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const missing = initial("2026-09-28"); missing.baseVersion = 1;
    await expect(save(missing, randomUUID(), "2026-09-28")).rejects.toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 0 } });
    const next = initial("2026-09-28");
    const firstWrites = await Promise.allSettled([save(next, randomUUID(), "2026-09-28"), save(next, randomUUID(), "2026-09-28")]);
    expect(firstWrites.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("inherits only unchanged positions and revalidates every restored soup", async () => {
    let saved = (await save()).body;
    await change(meat, "改名且改类", "vegetable", false);
    await change(soup, "新汤名", "soup", false);
    let draft = input(saved); draft.meals[0]!.soupOmitted = true; draft.meals[1]!.meat = [otherMeat];
    saved = (await save(draft)).body;
    expect(saved.meals[0]!.meat[0]!.name).toBe("红烧肉");
    expect(saved.meals[0]!.soup[0]!.name).toBe("蛋花汤");
    expect(saved.meals[1]!.meat[0]!.name).toBe("清蒸鱼");
    draft = input(saved); draft.meals[0]!.soupOmitted = false;
    await expect(save(draft)).rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
    expect(await weeks.read(session, monday)).toEqual(saved);
    draft = input(saved); draft.meals[1]!.meat = [meat];
    await expect(save(draft)).rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
    await expect(save({ ...input(saved), rebuild: true })).rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
    await dishes.update(session, randomUUID(), soup, { baseVersion: 2, name: "恢复后的汤", category: "soup", active: true });
    draft = input(saved); draft.meals[0]!.soupOmitted = false;
    saved = (await save(draft)).body;
    expect(saved.meals[0]!.soup[0]!.name).toBe("恢复后的汤");
    expect(saved.meals[1]!.soup[0]!.name).toBe("蛋花汤");
  });

  it("rejects moved snapshots, foreign or missing dishes, wrong class, changed structure and forged names", async () => {
    const first = initial(); first.structure.meat = 2; first.meals.forEach((meal) => meal.meat.push(otherMeat));
    const saved = (await save(first)).body;
    await change(meat, "已停用", "meat", false);
    const moved = input(saved); moved.meals[0]!.meat.reverse();
    await expect(save(moved)).rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
    const changedStructure = input(saved); changedStructure.structure = { meat: 1, vegetable: 0, soup: 1 };
    changedStructure.meals.forEach((meal) => meal.meat.pop());
    await expect(save(changedStructure)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const wrongClass = (await dishes.create(session, randomUUID(), { items: [{ name: "其他汤", category: "soup" }] })).body.items[0]!.id;
    for (const id of [randomUUID(), wrongClass]) {
      const draft = input(saved); draft.meals[0]!.meat[0] = id;
      await expect(save(draft)).rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
    }
    const missing = input(saved); missing.meals[0]!.meat.pop();
    await expect(save(missing)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(weeks.save(session, randomUUID(), monday, { ...input(saved), ownerId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const foreign = { ...session, merchantId: randomUUID() };
    expect((await weeks.list(foreign)).items).toEqual([]);
    await expect(weeks.read(foreign, monday)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(weeks.save(foreign, randomUUID(), monday, initial())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await weeks.read(session, monday)).toEqual(saved);
  });

  it("saves confirmation with content, preserves repeated confirmation time and clears it on ordinary edits", async () => {
    let saved = (await save({ ...initial(), confirm: true })).body;
    const confirmedAt = saved.confirmedAt;
    now = new Date(now.getTime() + 1000);
    await change(meat, "新的肉名");
    saved = (await save({ ...input(saved), confirm: true })).body;
    expect(saved.confirmedAt).toBe(confirmedAt);
    saved = (await save({ ...input(saved), rebuild: true, confirm: true })).body;
    expect(saved.confirmedAt).toBe(now.toISOString());
    expect(saved.meals[0]!.meat[0]!.name).toBe("新的肉名");
    const draft = input(saved); draft.meals[0]!.soupOmitted = true;
    saved = (await save(draft)).body;
    expect(saved.confirmedAt).toBeNull();
    now = new Date(now.getTime() + 1000);
    saved = (await save({ ...input(saved), confirm: true })).body;
    expect(saved.confirmedAt).toBe(now.toISOString());
  });

  it("rolls back content and confirmation when receipt insertion fails, and permits same-key recovery", async () => {
    const saved = (await save({ ...initial(), confirm: true })).body, key = randomUUID();
    const draft = input(saved); draft.meals[0]!.meat = [otherMeat];
    await pool.query(`CREATE FUNCTION reject_week_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected failure'; END $$;
      CREATE TRIGGER reject_week_receipt BEFORE INSERT ON mutation_receipts FOR EACH ROW EXECUTE FUNCTION reject_week_receipt()`);
    try {
      await expect(save(draft, key)).rejects.toMatchObject({ code: "P0001" });
      expect(await weeks.read(session, monday)).toEqual(saved);
      expect((await pool.query("SELECT 1 FROM mutation_receipts WHERE idempotency_key = $1", [key])).rowCount).toBe(0);
    } finally { await pool.query("DROP TRIGGER reject_week_receipt ON mutation_receipts; DROP FUNCTION reject_week_receipt()"); }
    expect((await save(draft, key)).body.version).toBe(2);
  });

  it("rechecks dishes and session after the merchant lock, and enforces expired receipt versions", async () => {
    const saved = (await save()).body, key = randomUUID(), draft = input(saved);
    draft.meals[0]!.meat = [otherMeat];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM merchants WHERE id = $1 FOR UPDATE", [session.merchantId]);
      const pending = save(draft, key);
      await client.query("UPDATE dishes SET active = false WHERE id = $1", [otherMeat]);
      await client.query("COMMIT");
      await expect(pending).rejects.toMatchObject({ code: "DISH_UNAVAILABLE" });
    } finally { client.release(); }
    expect(await weeks.read(session, monday)).toEqual(saved);
    await save(input(saved), key);
    now = new Date(now.getTime() + 86_400_000);
    await expect(save(input(saved), key)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await sessions.revoke(session);
    await expect(save()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("serves authenticated HTTP previews, writes, pagination and safe errors", async () => {
    const logger = vi.fn(), server = createKithInnHttpServer({ sessions, weeks, logger, readiness: async () => {} });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/kith-inn/weeks`;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() };
    const get = (path = "") => fetch(base + path, { headers });
    const put = (body: unknown, path = `/${monday}`, extra = headers) => fetch(base + path, { method: "PUT", headers: extra, body: JSON.stringify(body) });
    try {
      expect((await fetch(base)).status).toBe(401);
      expect((await get(`/${monday}`)).status).toBe(404);
      const data = initial();
      const preview = await fetch(`${base}/${monday}/generate`, { method: "POST", headers,
        body: JSON.stringify({ structure: data.structure, meals: data.meals.map(({ date, mealType, enabled }) => ({ date, mealType, enabled })) }) });
      expect(preview.status).toBe(200); MenuPreviewSchema.parse(await preview.json());
      const response = await put(data); expect(response.status).toBe(200);
      const saved = WeekPlanSchema.parse(await response.json());
      expect(WeekPlanSchema.parse(await (await get(`/${monday}`)).json())).toEqual(saved);
      await save(initial("2026-09-28"), randomUUID(), "2026-09-28");
      const page = WeekListSchema.parse(await (await get("?limit=1")).json());
      expect(page.items.map((item) => item.weekStart)).toEqual(["2026-09-28"]); expect(page.nextBefore).toBe("2026-09-28");
      const last = WeekListSchema.parse(await (await get(`?before=${page.nextBefore}&limit=1`)).json());
      expect(last.items[0]!.weekStart).toBe(monday); expect(last.nextBefore).toBeNull();
      for (const path of ["?limit=0", "?limit=53", "?limit=1&limit=2", "?ownerId=x", "?__proto__=x", "?before=2026-09-22", "?limit=", "?limit=1.5", "/bad", `/${monday}?limit=1`]) {
        expect((await get(path)).status, path).toBe(400);
      }
      expect((await put(data, `/${monday}`, { authorization: headers.authorization, "content-type": "application/json" } as typeof headers)).status).toBe(400);
      expect((await put({ ...data, meals: [] })).status).toBe(400);
      const conflict = await put({ ...data, confirm: true }); expect(conflict.status).toBe(409);
      expect(JSON.stringify(logger.mock.calls)).not.toMatch(new RegExp(`${token}|红烧肉|${meat}|2026-09-21`));
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
