import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createKithInnPool } from "../src/database.ts";

/** @param {import('pg').Pool} pool */
export async function migrate(pool, directory = new URL("../migrations/", import.meta.url)) {
  const names = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("No kith-inn migration files found");
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(name, directory), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [20260920, 3305]);
    await client.query(`CREATE TABLE IF NOT EXISTS kith_inn_migrations (
      name text PRIMARY KEY, checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query("SELECT name, checksum FROM kith_inn_migrations");
    for (const row of applied.rows) {
      if (migrations.find((migration) => migration.name === row.name)?.checksum !== row.checksum) {
        throw new Error("An applied kith-inn migration is missing or its checksum changed");
      }
    }
    for (const migration of migrations) {
      if (applied.rows.some((row) => row.name === migration.name)) continue;
      await client.query(migration.sql);
      await client.query("INSERT INTO kith_inn_migrations (name, checksum) VALUES ($1, $2)", [migration.name, migration.checksum]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release(true);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool;
  try {
    pool = createKithInnPool();
    await migrate(pool);
  } catch {
    console.error("kith-inn migration failed; verify database access and unchanged migration files");
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
