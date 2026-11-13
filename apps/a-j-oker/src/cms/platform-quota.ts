import { sql } from "@payloadcms/db-sqlite";
import { setTimeout } from "node:timers/promises";
import Database from "libsql";
import type { Payload } from "payload";
import { AppError } from "../domain/contracts";
import { quotaDatabasePath } from "./daily-quota";

function dailyCallLimit() {
  const configured = process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT ?? "900";
  const limit = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(limit))
    throw new AppError(503, "平台模型额度配置无效，请联系管理员");
  return limit;
}

export async function checkPlatformQuota(payload: Payload) {
  dailyCallLimit();
  // A read-only probe also works before the first reservation. Exhausted or
  // intentionally paused budgets are healthy; neither should restart the app.
  await payload.db.drizzle.all(sql`
    SELECT day, reserved_calls FROM platform_model_quotas LIMIT 1
  `);
}

// One ledger for every platform visitor/worker using this Payload database.
// Reserve the entire operation before any provider work. Never refund failures:
// a timeout or crash cannot prove that the provider did not already bill us.
export async function reservePlatformCalls(payload: Payload, calls: number) {
  const limit = dailyCallLimit();
  if (!Number.isSafeInteger(calls) || calls < 1)
    throw new Error("Invalid platform call reservation");
  const exhausted = () =>
    new AppError(
      429,
      "平台今日共享模型额度不足，请稍后再试，或在设置中使用自己的密钥或外部 Agent",
    );
  if (calls > limit) throw exhausted();
  const filename = quotaDatabasePath(payload);
  const deadline = Date.now() + 5_000;
  // A single conditional UPSERT makes checking and charging atomic, including
  // the first request of the UTC day, across processes and fresh identities.
  for (let attempt = 0; ; attempt++) {
    let database: Database.Database | undefined;
    let retryDelay = 0;
    try {
      // Own and close every attempt: the async adapter can retain a failed
      // SQLITE_BUSY statement and keep other processes locked after a retry.
      database = new Database(filename);
      const db = database;
      db.transaction(() => {
        // Take the writer before choosing the UTC bucket, including retries
        // that cross midnight while waiting for another business transaction.
        const day = new Date().toISOString().slice(0, 10);
        const result = db.prepare(`
          INSERT INTO platform_model_quotas (day, reserved_calls)
          VALUES (?, ?)
          ON CONFLICT(day) DO UPDATE
            SET reserved_calls = reserved_calls + excluded.reserved_calls
            WHERE reserved_calls <= ?
        `).run(day, calls, limit - calls);
        if (result.changes === 0) throw exhausted();
        if (result.changes !== 1) throw new Error("Platform quota was not updated exactly once");
      }).immediate();
      return;
    } catch (error) {
      // Retry only a known busy failure after rollback, never an ambiguous
      // connection/storage failure or a transaction that is still active.
      if (database?.inTransaction)
        throw new AppError(503, "暂时无法确认平台模型额度，请稍后重试");
      if (error instanceof AppError) throw error;
      let busy = false;
      for (let cause = error; cause instanceof Error; cause = cause.cause)
        if ("code" in cause && cause.code === "SQLITE_BUSY") busy = true;
      const remaining = deadline - Date.now();
      if (!busy || remaining <= 0)
        throw new AppError(503, "暂时无法确认平台模型额度，请稍后重试");
      // Business writes can legitimately exceed the old 375 ms retry window.
      // Keep the total wait bounded, and never retry unknown storage failures.
      retryDelay = Math.min(25 * 2 ** attempt, 250, remaining);
    } finally {
      database?.close();
    }
    await setTimeout(retryDelay);
  }
}
