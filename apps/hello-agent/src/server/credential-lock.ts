import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../domain/contracts";

const active = new Map<string, symbol>();
const executions = new Map<string, number>();
const context = new AsyncLocalStorage<{ owner: string; token: symbol }>();
// Current single-process deployment: all owner credential mutations use this
// guard. Replace it with a shared lease before running multiple app processes.
export async function withCredentialLock<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const held = context.getStore();
  if (held?.owner === owner && active.get(owner) === held.token) return action();
  if (active.has(owner) || executions.has(owner)) throw new AppError(409, "此身份仍有请求正在处理，请稍后重试连接变更或删除");
  const token = Symbol();
  active.set(owner, token);
  try { return await context.run({ owner, token }, action); }
  finally { active.delete(owner); }
}

// Business requests can run concurrently (including multi-image uploads), but
// credentials/consent cannot change until all admitted work has completed.
// Nested execution leases can outlive the HTTP Response that starts a stream.
export async function withCredentialExecution<T>(owner: string, action: () => Promise<T>): Promise<T> {
  if (active.has(owner)) throw new AppError(409, "此身份正在更新连接或删除数据，请稍后重试");
  executions.set(owner, (executions.get(owner) || 0) + 1);
  try { return await action(); }
  finally {
    const remaining = executions.get(owner)! - 1;
    if (remaining) executions.set(owner, remaining);
    else executions.delete(owner);
  }
}
