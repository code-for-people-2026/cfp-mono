import { Pool, type PoolClient, type PoolConfig } from "pg";
import { resolveKithInnDatabaseUrl } from "./config";

export function createKithInnPool(
  environment: NodeJS.ProcessEnv = process.env,
  options: Pick<PoolConfig, "connectionTimeoutMillis" | "statement_timeout"> = {}
): Pool {
  return new Pool({
    max: 5,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    ...options,
    connectionString: resolveKithInnDatabaseUrl(environment)
  });
}

export async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
