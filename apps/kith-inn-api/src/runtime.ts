import { createHash } from "node:crypto";
import type { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { Pool, QueryConfig } from "pg";
import { createWechatExchanger } from "./auth";
import { loadKithInnRuntimeConfig } from "./config";
import { createKithInnPool } from "./database";
import { createKithInnHttpServer, type SafeLogger } from "./http";
import { Sessions } from "./sessions";

export async function createReadinessProbe(pool: Pick<Pool, "query">) {
  const name = "0001_initial.sql";
  const checksum = createHash("sha256").update(await readFile(new URL(`../migrations/${name}`, import.meta.url))).digest("hex");
  // ponytail: this release has one migration; extend this manifest when adding another.
  const query: QueryConfig & { query_timeout: number } = {
    text: `SELECT count(*) = 1 AND bool_and(name = $1 AND checksum = $2)
      AND to_regclass('merchants') IS NOT NULL AND to_regclass('sessions') IS NOT NULL
      AND to_regclass('dishes') IS NOT NULL AND to_regclass('week_plans') IS NOT NULL
      AND to_regclass('mutation_receipts') IS NOT NULL AS ready FROM kith_inn_migrations`,
    values: [name, checksum], query_timeout: 2_000
  };
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        pool.query<{ ready: boolean }>(query),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("READINESS_TIMEOUT")), 2_000); timer.unref(); })
      ]);
      if (result.rows[0]?.ready !== true) throw new Error("SCHEMA_NOT_READY");
    } finally { clearTimeout(timer); }
  };
}

export function installGracefulShutdown(server: Server, pool: Pick<Pool, "end">, signals: Pick<EventEmitter, "once" | "off"> = process) {
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { server.closeAllConnections(); resolve(); }, 10_000);
        server.close(() => { clearTimeout(timer); resolve(); });
      });
    } finally {
      signals.off("SIGTERM", onSignal);
      signals.off("SIGINT", onSignal);
      await pool.end();
    }
  })();
  const onSignal = () => { void close().catch(() => { process.exitCode = 1; }); };
  signals.once("SIGTERM", onSignal);
  signals.once("SIGINT", onSignal);
  return close;
}

export async function startKithInnRuntime(input: Readonly<{
  environment?: NodeJS.ProcessEnv; fetcher?: typeof fetch; logger?: SafeLogger; pool?: Pool;
}> = {}) {
  const config = loadKithInnRuntimeConfig(input.environment);
  const pool = input.pool ?? createKithInnPool({ KITH_INN_DATABASE_URL: config.databaseUrl }, {
    connectionTimeoutMillis: 2_000, statement_timeout: 2_000
  });
  // pg removes failed idle clients before this event; readiness reports availability.
  // Never propagate the original connection error, which may contain credentials.
  const onPoolError = () => {};
  pool.on("error", onPoolError);
  const closePool = async () => {
    try { await pool.end(); }
    finally { pool.off("error", onPoolError); }
  };
  try {
    const sessions = new Sessions(pool, { appId: config.wechatAppId, ownerOpenId: config.wechatOwnerOpenId },
      createWechatExchanger({ appId: config.wechatAppId, appSecret: config.wechatAppSecret, fetcher: input.fetcher }));
    const server = createKithInnHttpServer({ sessions, readiness: await createReadinessProbe(pool), logger: input.logger });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "0.0.0.0", () => { server.off("error", reject); resolve(); });
    });
    return { server, close: installGracefulShutdown(server, { end: closePool }) };
  } catch (error) {
    await closePool();
    throw error;
  }
}
