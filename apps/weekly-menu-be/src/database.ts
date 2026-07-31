import { Pool } from "pg";
import { resolveWeeklyMenuDatabaseUrl } from "./database-url.mjs";

export { resolveWeeklyMenuDatabaseUrl } from "./database-url.mjs";

export function createWeeklyMenuPool(
  environment: NodeJS.ProcessEnv = process.env
): Pool {
  return new Pool({ connectionString: resolveWeeklyMenuDatabaseUrl(environment) });
}
