import { Pool, type PoolConfig } from "pg";
import { resolveKithInnDatabaseUrl } from "./config";

export function createKithInnPool(
  environment: NodeJS.ProcessEnv = process.env,
  options: Pick<PoolConfig, "connectionTimeoutMillis" | "statement_timeout"> = {}
): Pool {
  return new Pool({
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    ...options,
    connectionString: resolveKithInnDatabaseUrl(environment)
  });
}
