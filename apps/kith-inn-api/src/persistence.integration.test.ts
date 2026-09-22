import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../scripts/migrate.mjs";
import { resolveKithInnTestDatabaseUrl } from "./config";
import { createKithInnPool } from "./database";

const databaseUrl = resolveKithInnTestDatabaseUrl(); // Missing/unsafe configuration fails the suite; never skip.
const pool = createKithInnPool({ KITH_INN_DATABASE_URL: databaseUrl });
const merchantId = randomUUID();
const meals = JSON.stringify(Array.from({ length: 14 }, () => ({})));
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const insertDish = "INSERT INTO dishes (merchant_id, name, category) VALUES ($1, $2, $3)";
const insertWeek = `INSERT INTO week_plans (merchant_id, week_start, structure, meals)
  VALUES ($1, $2, '{"meat":1,"vegetable":0,"soup":0}', $3)`;
const insertReceipt = `INSERT INTO mutation_receipts
  (merchant_id, idempotency_key, request_hash, response_status, response_body)
  VALUES ($1, $2, $3, 201, '{"saved":true}')`;

describe("kith-inn PostgreSQL 17 persistence", () => {
  beforeAll(async () => {
    const { rows: [target] } = await pool.query("SELECT current_database() AS name, current_setting('server_version_num')::int AS version");
    if (!target.name.endsWith("_test")) throw new Error("Refusing to modify a database without the _test suffix");
    expect(target.version).toBeGreaterThanOrEqual(170000);
    expect(target.version).toBeLessThan(180000);
    await Promise.all([migrate(pool), migrate(pool)]);
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/migrate.mjs"], {
      cwd: new URL("../", import.meta.url), env: { ...process.env, KITH_INN_DATABASE_URL: databaseUrl }
    });
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE mutation_receipts, week_plans, dishes, sessions, merchants");
    await pool.query("INSERT INTO merchants (id, app_id, openid) VALUES ($1, 'test-app', 'test-owner')", [merchantId]);
  });
  afterAll(async () => { await pool.end(); });

  it("records one checksum after concurrent and repeated migrations and creates only the intended tables", async () => {
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name");
    expect(rows.map((row) => row.table_name)).toEqual(["dishes", "kith_inn_migrations", "merchants", "mutation_receipts", "sessions", "week_plans"]);
    expect((await pool.query("SELECT name, checksum FROM kith_inn_migrations")).rows).toEqual([
      { name: "0001_initial.sql", checksum: expect.stringMatching(/^[a-f0-9]{64}$/) }
    ]);
  });

  it("rejects changed or missing applied migrations and rolls back a failed new migration", async () => {
    const folder = await mkdtemp(join(tmpdir(), "kith-inn-migrations-"));
    const directory = pathToFileURL(`${folder}/`);
    const original = await readFile(migrationUrl, "utf8");
    try {
      await writeFile(join(folder, "0001_initial.sql"), `${original}\n-- changed\n`);
      await expect(migrate(pool, directory)).rejects.toThrow("checksum changed");
      await rm(join(folder, "0001_initial.sql"));
      await writeFile(join(folder, "0002_failure.sql"), "CREATE TABLE rollback_probe (id integer); SELECT 1/0;");
      await expect(migrate(pool, directory)).rejects.toThrow("missing");
      await writeFile(join(folder, "0001_initial.sql"), original);
      await expect(migrate(pool, directory)).rejects.toMatchObject({ code: "22012" });
      expect((await pool.query("SELECT to_regclass('rollback_probe') AS probe")).rows[0].probe).toBeNull();
      expect((await pool.query("SELECT count(*)::int AS count FROM kith_inn_migrations")).rows[0].count).toBe(1);
      await migrate(pool);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it("permits only one merchant and protects every account foreign key", async () => {
    await expect(pool.query("INSERT INTO merchants (app_id, openid) VALUES ('another-app', 'another-owner')")).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query("UPDATE merchants SET singleton = false")).rejects.toMatchObject({ code: "23514" });
    const stranger = randomUUID();
    await expect(pool.query(insertDish, [stranger, "红烧肉", "meat"])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(insertWeek, [stranger, "2026-09-21", meals])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query(insertReceipt, [stranger, randomUUID(), Buffer.alloc(32)])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query("INSERT INTO sessions (merchant_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')", [stranger, Buffer.alloc(32)])).rejects.toMatchObject({ code: "23503" });
  });

  it("reserves inactive dish names and enforces canonical names, categories and positive versions", async () => {
    await pool.query(insertDish, [merchantId, "红烧肉", "meat"]);
    await pool.query("UPDATE dishes SET active = false");
    await expect(pool.query(insertDish, [merchantId, "红烧肉", "soup"])).rejects.toMatchObject({ code: "23505" });
    for (const [name, category] of [["", "meat"], [" 红烧肉", "meat"], ["e\u0301", "meat"], ["汤", "unknown"], ["菜".repeat(61), "vegetable"]]) {
      await expect(pool.query(insertDish, [merchantId, name, category])).rejects.toMatchObject({ code: "23514" });
    }
    await pool.query(insertDish, [merchantId, "é", "vegetable"]);
    await pool.query(insertDish, [merchantId, "É", "vegetable"]);
    await expect(pool.query("UPDATE dishes SET version = 0")).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT collation_name FROM information_schema.columns WHERE table_name = 'dishes' AND column_name = 'name'")).rows[0].collation_name).toBe("C");
  });

  it("enforces Monday, 14 meals, positive versions and one saved week without locking confirmation", async () => {
    await pool.query(insertWeek, [merchantId, "2026-09-21", meals]);
    await expect(pool.query(insertWeek, [merchantId, "2026-09-21", meals])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query(insertWeek, [merchantId, "2026-09-22", meals])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(insertWeek, [merchantId, "2026-09-28", "[]"])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE week_plans SET structure = '[]'")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE week_plans SET version = 0")).rejects.toMatchObject({ code: "23514" });
    await pool.query("UPDATE week_plans SET confirmed_at = now()");
    await pool.query("UPDATE week_plans SET confirmed_at = NULL, version = version + 1");
    expect((await pool.query("SELECT confirmed_at, version FROM week_plans")).rows).toEqual([{ confirmed_at: null, version: 2 }]);
  });

  it("stores only hashes with valid lifetimes and constrains successful replay receipts", async () => {
    const session = "INSERT INTO sessions (merchant_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')";
    await pool.query(session, [merchantId, Buffer.alloc(32)]);
    await expect(pool.query(session, [merchantId, Buffer.alloc(31)])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE sessions SET expires_at = created_at")).rejects.toMatchObject({ code: "23514" });
    const key = randomUUID();
    await pool.query(insertReceipt, [merchantId, key, Buffer.alloc(32)]);
    await expect(pool.query(insertReceipt, [merchantId, key, Buffer.alloc(32)])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query(insertReceipt, [merchantId, randomUUID(), Buffer.alloc(31)])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE mutation_receipts SET response_status = 500")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE mutation_receipts SET expires_at = created_at + interval '25 hours'")).rejects.toMatchObject({ code: "23514" });
  });

  it("rolls back a partial dish batch and its success receipt together", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(insertDish, [merchantId, "红烧肉", "meat"]);
      await client.query(insertReceipt, [merchantId, randomUUID(), Buffer.alloc(32)]);
      await expect(client.query(insertDish, [merchantId, "红烧肉", "meat"])).rejects.toMatchObject({ code: "23505" });
    } finally { await client.query("ROLLBACK"); client.release(); }
    expect((await pool.query("SELECT count(*)::int AS count FROM dishes")).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM mutation_receipts")).rows[0].count).toBe(0);
  });
});
