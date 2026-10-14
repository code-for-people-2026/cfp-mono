import { randomUUID } from "node:crypto";
import type { Payload } from "payload";
import { AppError } from "../domain/contracts";

// Database uniqueness, not an in-process mutex. Expired workers cannot finalize.
export async function withAgeLock<T>(payload: Payload, key: string, task: (assertLease: () => Promise<void>) => Promise<T>): Promise<T> {
  await payload.delete({ collection: "age-locks", overrideAccess: true, where: { and: [{ key: { equals: key } }, { expiresAt: { less_than: new Date().toISOString() } }] } });
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  let id: number | string;
  try { id = (await payload.create({ collection: "age-locks", overrideAccess: true, data: { key, nonce, expiresAt } })).id; }
  catch { throw new AppError(409, "正在处理登录或核验，请稍后重试"); }
  const assertLease = async () => {
    const current = await payload.find({ collection: "age-locks", overrideAccess: true, limit: 1, where: { and: [{ key: { equals: key } }, { nonce: { equals: nonce } }, { expiresAt: { greater_than: new Date().toISOString() } }] } });
    if (!current.docs.length) throw new AppError(409, "本次核验已超时，请重新发起");
  };
  try { return await task(assertLease); }
  finally { await payload.delete({ collection: "age-locks", overrideAccess: true, where: { and: [{ id: { equals: id } }, { nonce: { equals: nonce } }] } }); }
}
