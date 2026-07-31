import { Pool, type PoolConfig } from "pg";
import { resolveWeeklyMenuDatabaseUrl } from "./database-url.mjs";

export { resolveWeeklyMenuDatabaseUrl } from "./database-url.mjs";

export function createWeeklyMenuPool(
  environment: NodeJS.ProcessEnv = process.env,
  options: Pick<PoolConfig, "connectionTimeoutMillis" | "statement_timeout"> = {}
): Pool {
  return new Pool({
    ...options,
    connectionString: resolveWeeklyMenuDatabaseUrl(environment)
  });
}
