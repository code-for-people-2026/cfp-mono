import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "libsql";
import type { Payload } from "payload";
import { AppError } from "../domain/contracts";

type Counter = { key: string; limit: number };

function quotaDatabasePath(payload: Payload) {
  // This app uses a file SQLite database. A separate :memory: connection would
  // silently create a different ledger; remote/replicated adapters need their
  // own atomic implementation instead of falling back to local counters.
  try {
    if (!("clientConfig" in payload.db)) throw new Error();
    const config = payload.db.clientConfig;
    if (!config || typeof config !== "object" || !("url" in config) || typeof config.url !== "string") throw new Error();
    if (Object.entries(config).some(([key, value]) => key !== "url" && value !== undefined) || !config.url.startsWith("file:") || /[?#]/.test(config.url)) throw new Error();
    const filename = config.url.startsWith("file://") ? fileURLToPath(config.url) : decodeURIComponent(config.url.slice(5));
    if (!filename || filename === ":memory:" || filename.includes("\0")) throw new Error();
    return filename;
  } catch { throw new AppError(503, "共享额度需要独立文件 SQLite 数据库，请联系管理员"); }
}

// Reserve both daily counters or neither. Namespaces keep cleanup separate from
// text-model quota and from each other; refused requests allocate no new keys.
export async function reserveDailyQuota(payload: Payload, {
  namespace, counters, exhaustedMessage, unavailableMessage,
}: {
  namespace: "admission" | "image" | "image-review";
  counters: readonly [Counter, Counter];
  exhaustedMessage: string;
  unavailableMessage: string;
}) {
  if (counters.some(({ limit }) => !Number.isSafeInteger(limit) || limit < 0)) throw new Error("Invalid daily quota limit");
  if (counters.some(({ limit }) => limit === 0)) throw new AppError(429, exhaustedMessage);
  const filename = quotaDatabasePath(payload);
  const deadline = Date.now() + 5_000;
  for (let attempt = 0; ; attempt++) {
    let database: Database.Database | undefined;
    let retryDelay = 0;
    try {
      // Own a native connection so every failed statement can be closed. The
      // async adapter detaches transaction handles from client.close().
      database = new Database(filename);
      const db = database;
      db.transaction(() => {
        // A busy retry may cross midnight. Pick the UTC day only after taking
        // the writer, so a waiting request cannot recreate yesterday's bucket.
        const day = new Date().toISOString().slice(0, 10);
        const prefix = `${namespace}:${day}:`;
        db.prepare("DELETE FROM platform_model_quotas WHERE day >= ? AND day < ?").run(`${namespace}:`, prefix);
        for (const { key, limit } of counters) {
          const result = db.prepare("INSERT INTO platform_model_quotas (day, reserved_calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET reserved_calls = reserved_calls + 1 WHERE reserved_calls < ?").run(`${prefix}${key}`, limit);
          if (result.changes === 0) throw new AppError(429, exhaustedMessage);
          if (result.changes !== 1) throw new Error("Daily quota counter was not updated exactly once");
        }
      }).immediate();
      return;
    } catch (error) {
      // The synchronous driver rolls back failed writes/COMMIT. Retry only a
      // known SQLite busy failure after rollback, never an ambiguous outcome.
      if (database?.inTransaction) throw new AppError(503, unavailableMessage);
      if (error instanceof AppError) throw error;
      let busy = false;
      for (let cause = error; cause instanceof Error; cause = cause.cause)
        if ("code" in cause && cause.code === "SQLITE_BUSY") busy = true;
      const remaining = deadline - Date.now();
      // Competing business transactions can legitimately hold the writer for
      // longer than 375 ms. Retry only known uncommitted SQLITE_BUSY failures,
      // with a bounded budget; ambiguous storage failures remain closed.
      if (!busy || remaining <= 0) throw new AppError(503, unavailableMessage);
      retryDelay = Math.min(25 * 2 ** attempt, 250, remaining);
    } finally {
      database?.close();
    }
    await setTimeout(retryDelay);
  }
}
