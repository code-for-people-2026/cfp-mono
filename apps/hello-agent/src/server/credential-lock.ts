import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../domain/contracts";

const active = new Map<string, symbol>();
const context = new AsyncLocalStorage<{ owner: string; token: symbol }>();
// Current single-process deployment: all owner credential mutations use this
// guard. Replace it with a shared lease before running multiple app processes.
export async function withCredentialLock<T>(owner: string, action: () => Promise<T>): Promise<T> {
  const held = context.getStore();
  if (held?.owner === owner && active.get(owner) === held.token) return action();
  if (active.has(owner)) throw new AppError(409, "此身份正在更新连接或删除数据，请稍后重试");
  const token = Symbol();
  active.set(owner, token);
  try { return await context.run({ owner, token }, action); }
  finally { active.delete(owner); }
}
