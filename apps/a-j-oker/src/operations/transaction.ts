import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Payload, type PayloadRequest } from "payload";

// SQLite's local adapter shares a connection. Keep transaction lifetimes serial
// on one Payload instance; the database still coordinates separate processes.
const queues = new WeakMap<Payload, Promise<void>>();
const commitActions = new WeakMap<PayloadRequest, Array<() => Promise<void>>>();

// External durability records cannot participate in SQLite's transaction.
// Callers append an intent before their database mutation, then register the
// matching confirmation here. A confirmation failure is reported after the DB
// commit and leaves an intentionally ambiguous intent that blocks restoration.
export function afterTransactionCommit(req: PayloadRequest, action: () => Promise<void>) {
  const actions = commitActions.get(req) || [];
  actions.push(action);
  commitActions.set(req, actions);
}

export async function transaction<T>(payload: Payload, action: (req: PayloadRequest) => Promise<T>) {
  const previous = queues.get(payload) || Promise.resolve();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  queues.set(payload, waiting);
  await previous;
  try {
    const req = await createLocalReq({ context: { safetyInternal: true } }, payload);
    if (!await initTransaction(req)) throw new Error("Safety operations require a database transaction");
    let committed = false;
    try {
      const result = await action(req);
      await commitTransaction(req);
      committed = true;
      for (const confirm of commitActions.get(req) || []) await confirm();
      return result;
    } catch (error) {
      if (!committed) await killTransaction(req);
      throw error;
    } finally { commitActions.delete(req); }
  } finally {
    release();
    if (queues.get(payload) === waiting) queues.delete(payload);
  }
}
