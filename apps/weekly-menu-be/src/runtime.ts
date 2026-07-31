import type { Server } from "node:http";
import type { Pool, QueryConfig } from "pg";
import { SessionService, createWechatCodeExchanger } from "./auth";
import { loadWeeklyMenuRuntimeConfig } from "./config";
import { createWeeklyMenuPool } from "./database";
import { createWeeklyMenuHttpServer, type SafeLogger } from "./http";
import { fetchRecipePools } from "./recipes-client";
import { WeeklyMenuStore } from "./store";
import { WeeklyMenuService } from "./weekly-menu-service";

const READINESS_TIMEOUT_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

type TimedQueryConfig = QueryConfig & Readonly<{ query_timeout: number }>;

type SignalTarget = Readonly<{
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}>;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("READINESS_TIMEOUT")), timeoutMs);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function createReadinessProbe(input: Readonly<{
  checkDatabase: () => Promise<unknown>;
  fetchRecipes: () => Promise<Readonly<{
    bigMeat: readonly string[];
    smallMeat: readonly string[];
    vegetable: readonly string[];
  }>>;
  timeoutMs?: number;
}>): () => Promise<void> {
  return async () => {
    const timeoutMs = input.timeoutMs ?? READINESS_TIMEOUT_MS;
    const [, recipes] = await Promise.all([
      withTimeout(input.checkDatabase(), timeoutMs),
      withTimeout(input.fetchRecipes(), timeoutMs)
    ]);
    if (
      recipes.bigMeat.length === 0 ||
      recipes.smallMeat.length === 0 ||
      recipes.vegetable.length === 0
    ) {
      throw new Error("RECIPES_INCOMPLETE");
    }
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server, timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
      resolve();
    }, timeoutMs);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function installGracefulShutdown(input: Readonly<{
  closePool: () => Promise<void>;
  closeServer: () => Promise<void>;
  logger?: (event: Readonly<{ event: "shutdown_complete" | "shutdown_started" }>) => void;
  signals?: SignalTarget;
}>): () => Promise<void> {
  const signals = input.signals ?? process;
  let shutdown: Promise<void> | undefined;
  const run = (): Promise<void> => {
    shutdown ??= (async () => {
      input.logger?.({ event: "shutdown_started" });
      await input.closeServer();
      await input.closePool();
      input.logger?.({ event: "shutdown_complete" });
      signals.off("SIGTERM", onSignal);
      signals.off("SIGINT", onSignal);
    })();
    return shutdown;
  };
  const onSignal = (): void => {
    void run();
  };
  signals.once("SIGTERM", onSignal);
  signals.once("SIGINT", onSignal);
  return run;
}

export async function startWeeklyMenuRuntime(input: Readonly<{
  environment?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  logger?: SafeLogger;
  pool?: Pool;
}> = {}): Promise<Readonly<{
  close: () => Promise<void>;
  port: number;
  server: Server;
}>> {
  const config = loadWeeklyMenuRuntimeConfig(input.environment);
  const fetcher = input.fetcher ?? fetch;
  const pool = input.pool ?? createWeeklyMenuPool({
    WEEKLY_MENU_DATABASE_URL: config.databaseUrl
  }, {
    connectionTimeoutMillis: READINESS_TIMEOUT_MS,
    statement_timeout: READINESS_TIMEOUT_MS
  });
  const store = new WeeklyMenuStore(pool);
  const auth = new SessionService(
    store,
    createWechatCodeExchanger({
      appId: config.wechatAppId,
      appSecret: config.wechatAppSecret,
      fetcher
    })
  );
  const readiness = createReadinessProbe({
    checkDatabase: async () => {
      // node-postgres supports per-query query_timeout although @types/pg omits it.
      const query: TimedQueryConfig = {
        text: "SELECT 1",
        query_timeout: READINESS_TIMEOUT_MS
      };
      await pool.query(query);
    },
    fetchRecipes: async () =>
      fetchRecipePools(config.recipesBaseUrl, (request, init) =>
        fetcher(request, {
          ...init,
          signal: AbortSignal.timeout(READINESS_TIMEOUT_MS)
        })
      )
  });
  const weeklyMenu = new WeeklyMenuService(store, async () =>
    fetchRecipePools(config.recipesBaseUrl, (request, init) =>
      fetcher(request, {
        ...init,
        signal: AbortSignal.timeout(READINESS_TIMEOUT_MS)
      })
    )
  );
  const server = createWeeklyMenuHttpServer({
    auth,
    readiness,
    release: config.release,
    logger: input.logger,
    weeklyMenu
  });

  try {
    await listen(server, config.port);
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    port: config.port,
    server,
    close: installGracefulShutdown({
      closeServer: async () => closeServer(server),
      closePool: async () => pool.end()
    })
  };
}
