import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import Database from "libsql";
import type { Payload } from "payload";
import { AppError } from "../domain/contracts";
import { rateLimitGroup } from "./http";
import { trustedPrivacyCaller } from "./request-source";

type Entry = "identity" | "safety";
const defaults = { identity: { caller: 100, global: 10_000 }, safety: { caller: 20, global: 1_000 } };
function dailyLimit(entry: Entry, scope: "caller" | "global") {
  const configured = process.env[`HELLO_${entry.toUpperCase()}_${scope.toUpperCase()}_DAILY_LIMIT`] ?? String(defaults[entry][scope]);
  const value = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value)) throw new AppError(503, "入口受理额度配置无效，请联系管理员");
  return value;
}

function admissionDatabasePath(payload: Payload) {
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
  } catch { throw new AppError(503, "入口受理额度需要独立文件 SQLite 数据库，请联系管理员"); }
}

// Anonymous owners can be minted again, so neither a cookie nor its owner ID is
// an abuse boundary. Use the proxy-confirmed caller plus a shared DB backstop.
export async function reservePublicAdmission(payload: Payload, request: Request, entry: Entry) {
  const caller = trustedPrivacyCaller(request);
  rateLimitGroup([
    { key: `public-admission:${entry}:caller:${caller}`, maximum: 20 },
    { key: `public-admission:${entry}:global`, maximum: 1_000 },
  ]);
  const callerLimit = dailyLimit(entry, "caller"), globalLimit = dailyLimit(entry, "global");
  const exhausted = () => new AppError(429, "当前来源或全站今日受理次数已达上限，请稍后再试");
  if (!callerLimit || !globalLimit) throw exhausted();
  const day = new Date().toISOString().slice(0, 10);
  const prefix = `admission:${day}:${entry}:`;
  const filename = admissionDatabasePath(payload);
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
        db.prepare("DELETE FROM platform_model_quotas WHERE day >= 'admission:' AND day < ?").run(`admission:${day}:`);
        for (const [key, limit] of [[`${prefix}caller:${caller}`, callerLimit], [`${prefix}global`, globalLimit]] as const) {
          const result = db.prepare("INSERT INTO platform_model_quotas (day, reserved_calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET reserved_calls = reserved_calls + 1 WHERE reserved_calls < ?").run(key, limit);
          if (result.changes === 0) throw exhausted();
          if (result.changes !== 1) throw new Error("Admission counter was not updated exactly once");
        }
      }).immediate();
      return;
    } catch (error) {
      // The synchronous driver rolls back failed writes/COMMIT. Retry only a
      // known SQLite busy failure after rollback, never an ambiguous outcome.
      if (database?.inTransaction) throw new AppError(503, "暂时无法确认入口受理额度，请稍后重试");
      if (error instanceof AppError) throw error;
      let busy = false;
      for (let cause = error; cause instanceof Error; cause = cause.cause)
        if ("code" in cause && cause.code === "SQLITE_BUSY") busy = true;
      const remaining = deadline - Date.now();
      // Competing business transactions can legitimately hold the writer for
      // longer than 375 ms. Retry only known uncommitted SQLITE_BUSY failures,
      // with a bounded budget; ambiguous storage failures remain closed.
      if (!busy || remaining <= 0) throw new AppError(503, "暂时无法确认入口受理额度，请稍后重试");
      retryDelay = Math.min(25 * 2 ** attempt, 250, remaining);
    } finally {
      database?.close();
    }
    await setTimeout(retryDelay);
  }
}
