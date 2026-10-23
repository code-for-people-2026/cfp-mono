import type { Payload } from "payload";

/** Serialize SQLite transactions from native Payload and domain services on the same adapter. */
export function serializeDatabaseTransactions(payload: Payload): void {
  const db = payload.db;
  const begin = db.beginTransaction.bind(db);
  const commit = db.commitTransaction.bind(db);
  const rollback = db.rollbackTransaction.bind(db);
  let tail: Promise<void> = Promise.resolve();
  const releases = new Map<number | string, () => void>();
  db.beginTransaction = async options => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      const id = await begin(options);
      if (id === null) release();
      else releases.set(id, release);
      return id;
    } catch (error) { release(); throw error; }
  };
  const finish = async (incoming: Parameters<typeof commit>[0], action: typeof commit) => {
    const id = await incoming;
    try { await action(id); }
    finally { releases.get(id)?.(); releases.delete(id); }
  };
  db.commitTransaction = id => finish(id, commit);
  db.rollbackTransaction = id => finish(id, rollback);
}
