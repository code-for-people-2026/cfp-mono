import { AsyncLocalStorage } from "node:async_hooks";
import type { CollectionBeforeChangeHook, PayloadRequest } from "payload";
import { AppError } from "../domain/contracts";

export const SESSION_LEASE_MS = 180_000;
const RENEW_AFTER_MS = 60_000;
type LeaseContext = { owner: string; id: number; createdAt: string; signal: AbortSignal };
const execution = new AsyncLocalStorage<LeaseContext>();

export function assertSessionLease(owner: string) {
  const lease = execution.getStore();
  if (lease?.owner === owner) lease.signal.throwIfAborted();
}

// Keep the callable release API used by existing consumers. run() binds this
// lease to async writes; callbacks outliving release stay fenced.
export function holdSessionLease(options: {
  owner: string;
  id: number;
  createdAt: string;
  expiresAt: number;
  renew: (now: number, expiresAt: number) => Promise<boolean>;
  release: () => Promise<void>;
}) {
  const controller = new AbortController();
  let closed = false;
  let renewal: ReturnType<typeof setTimeout> | undefined;
  let expiration: ReturnType<typeof setTimeout> | undefined;
  const lose = () => {
    clearTimeout(renewal); clearTimeout(expiration);
    controller.abort(new AppError(409, "本轮执行许可已失效，已停止写入；请刷新后重试或继续取图"));
  };
  const schedule = (expiresAt: number) => {
    if (closed || controller.signal.aborted) return;
    clearTimeout(expiration);
    expiration = setTimeout(lose, Math.max(0, expiresAt - Date.now()));
    expiration.unref?.();
    renewal = setTimeout(async () => {
      const now = Date.now();
      try {
        if (now >= expiresAt || !await options.renew(now, now + SESSION_LEASE_MS)) lose();
        else schedule(now + SESSION_LEASE_MS);
      } catch { lose(); }
    }, RENEW_AFTER_MS);
    renewal.unref?.();
  };
  schedule(options.expiresAt);
  const release = async () => {
    if (closed) return;
    closed = true;
    lose();
    // A delayed renewal is conditional on this acquisition, so it cannot recreate a
    // deleted lease or modify a replacement while cleanup runs.
    await options.release();
  };
  return Object.assign(release, {
    signal: controller.signal,
    run: <T>(action: () => Promise<T>) => execution.run({ owner: options.owner, id: options.id, createdAt: options.createdAt, signal: controller.signal }, async () => {
      controller.signal.throwIfAborted();
      return action();
    }),
  });
}

// Also used by operations transactions, which do not write owned collections.
export async function assertSessionLeaseInTransaction(owner: string, req: PayloadRequest) {
  const lease = execution.getStore();
  if (!lease || lease.owner !== owner) return;
  lease.signal.throwIfAborted();
  const current = await req.payload.find({ collection: "session-locks", overrideAccess: true, req, limit: 1, where: {
    and: [{ id: { equals: lease.id } }, { createdAt: { equals: lease.createdAt } }, { owner: { equals: lease.owner } }, { expiresAt: { greater_than: new Date().toISOString() } }],
  } });
  lease.signal.throwIfAborted();
  if (!current.docs.length) throw new AppError(409, "本轮执行许可已失效，不能继续保存内容");
}

// Read the lease in the same SQLite transaction as the business write. Even a
// paused process or a provider ignoring cancellation cannot publish after a
// replacement execution has acquired the session. Lock maintenance is exempt.
export const guardSessionLease: CollectionBeforeChangeHook = async ({ req, data, originalDoc, collection }) => {
  if (collection.slug !== "session-locks") await assertSessionLeaseInTransaction(data.owner ?? originalDoc?.owner, req);
  return data;
};
