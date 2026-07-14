import { sql } from "@payloadcms/db-postgres";
import type { Payload } from "payload";

export const CMS_MIGRATION_HEAD = "20260714_110001_kith_inn_trial_baseline";

const DESTRUCTIVE_MIGRATION_COMMANDS = new Set(["migrate:fresh", "migrate:reset", "migrate:refresh"]);

/** Fail closed before Payload can run a destructive migration in production. */
export function assertProductionMigrationCommand(
  nodeEnv = process.env.NODE_ENV,
  argv = process.argv,
): void {
  if (nodeEnv === "production" && argv.some((arg) => DESTRUCTIVE_MIGRATION_COMMANDS.has(arg))) {
    throw new Error("Destructive CMS migration commands are disabled in production");
  }
}

/** Require the deployed schema to be exactly at the checked-in migration head. */
export async function assertCmsMigrationHead(payload: Pick<Payload, "db">): Promise<void> {
  if (payload.db.name !== "postgres") throw new Error("CMS migration head unavailable");
  const result = await payload.db.execute({
    drizzle: payload.db.drizzle,
    // Payload records local schema pushes as batch -1 / name "dev". They are
    // not checked-in migrations and must not mask the latest applied release.
    sql: sql`SELECT "name" FROM "cms"."payload_migrations" WHERE "batch" >= 0 ORDER BY "id" DESC LIMIT 1`,
  });
  if ((result.rows[0] as { name?: string } | undefined)?.name !== CMS_MIGRATION_HEAD) {
    throw new Error("CMS migration head mismatch");
  }
}
