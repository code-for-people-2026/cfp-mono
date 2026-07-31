import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { resolveWeeklyMenuDatabaseUrl } from "../src/database-url.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(appRoot, "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const pool = new pg.Pool({ connectionString: resolveWeeklyMenuDatabaseUrl() });
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock($1, $2)", [20260731, 314]);
  for (const name of migrationFiles) {
    const alreadyApplied = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'weekly_menu_migrations'"
    );
    if (alreadyApplied.rowCount) {
      const result = await client.query(
        "SELECT 1 FROM weekly_menu_migrations WHERE name = $1",
        [name]
      );
      if (result.rowCount) continue;
    }

    const sql = await readFile(join(migrationsDirectory, name), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO weekly_menu_migrations (name) VALUES ($1)",
        [name]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  client.release(true);
  await pool.end();
}
