import { setTimeout as sleep } from "node:timers/promises";
import type { Payload } from "payload";
const installed = new WeakSet<object>();

// Wait only before BEGIN succeeds. Replaying a business transaction or a failed
// COMMIT could duplicate side effects or hide an uncertain notification result.
// Yield the event loop so another request in this process can release its writer.
export function installSqliteContentionWait(payload: Payload) {
  const client = payload.db.drizzle.$client;
  if (client.protocol !== "file" || installed.has(client)) return;
  installed.add(client);
  const begin = client.transaction.bind(client);
  client.transaction = async (mode?: "write" | "read" | "deferred") => {
    const deadline = Date.now() + 2_000;
    for (let attempt = 0; ; attempt++) {
      try { return await begin(mode); }
      catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        const remaining = deadline - Date.now();
        if (code !== "SQLITE_BUSY" || remaining <= 0) throw error;
        await sleep(Math.min(10 * 2 ** Math.min(attempt, 4), 100, remaining));
      }
    }
  };
}
