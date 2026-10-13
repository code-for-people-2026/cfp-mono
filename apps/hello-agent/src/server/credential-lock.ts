import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../domain/contracts";

const active = new Map<string, symbol>();
const executions = new Map<string, Set<symbol>>();
const drained = new Map<string, () => void>();
const context = new AsyncLocalStorage<{ owner: string; token: symbol }>();
const executionContext = new AsyncLocalStorage<{ owner: string; token: symbol }>();
// Current single-process deployment: all owner credential mutations use this
// guard. Replace it with a shared lease before running multiple app processes.
export async function withCredentialLock<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const held = context.getStore();
  if (held?.owner === owner && active.get(owner) === held.token) return action();
  if (active.has(owner)) throw new AppError(409, "此身份正在更新连接或删除数据，请稍后重试");
  const token = Symbol();
  // Record writer intent before waiting. New requests cannot keep extending
  // the drain, and a second mutation cannot revoke a freshly issued credential.
  active.set(owner, token);
  try {
    if (executions.has(owner)) await new Promise<void>((resolve) => drained.set(owner, resolve));
    return await context.run({ owner, token }, action);
  } finally { active.delete(owner); drained.delete(owner); }
}

// Business requests may run concurrently. Already-admitted work may extend its
// lifetime (AG-UI response -> background generation) while a mutation waits;
// unrelated requests and callbacks from completed executions cannot join it.
export async function withCredentialExecution<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const held = executionContext.getStore();
  const nested = held?.owner === owner && executions.get(owner)?.has(held.token);
  if (active.has(owner) && !nested) throw new AppError(409, "此身份正在更新连接或删除数据，请稍后重试");
  const token = Symbol();
  const leases = executions.get(owner) || new Set<symbol>();
  leases.add(token);
  executions.set(owner, leases);
  try { return await executionContext.run({ owner, token }, action); }
  finally {
    leases.delete(token);
    if (!leases.size) { executions.delete(owner); drained.get(owner)?.(); }
  }
}
