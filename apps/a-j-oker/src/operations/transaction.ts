import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Payload, type PayloadRequest } from "payload";

// SQLite's local adapter shares a connection. Keep transaction lifetimes serial
// on one Payload instance; the database still coordinates separate processes.
const queues = new WeakMap<Payload, Promise<void>>();

export async function transaction<T>(payload: Payload, action: (req: PayloadRequest) => Promise<T>) {
  const previous = queues.get(payload) || Promise.resolve();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  queues.set(payload, waiting);
  await previous;
  try {
    const req = await createLocalReq({ context: { safetyInternal: true } }, payload);
    if (!await initTransaction(req)) throw new Error("Safety operations require a database transaction");
    try { const result = await action(req); await commitTransaction(req); return result; }
    catch (error) { await killTransaction(req); throw error; }
  } finally {
    release();
    if (queues.get(payload) === waiting) queues.delete(payload);
  }
}
