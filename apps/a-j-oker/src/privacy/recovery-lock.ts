import { createHash } from "node:crypto";
import { AppError } from "../domain/contracts";

const active = new Set<string>();
// The current deployment runs one application process. Before adding replicas,
// replace this guard with a shared lease; do not queue overlapping recoveries,
// since the queued revocation would invalidate a just-issued credential.
export async function withRecovery<T>(code: string, recover: () => Promise<T>): Promise<T> {
  const key = createHash("sha256").update(code).digest("hex");
  if (active.has(key)) throw new AppError(409, "这个恢复码正在使用中，请等待当前恢复完成后再试");
  // Acquired before the first lookup: delayed valid requests using the same
  // code cannot pass lookup together and then interleave revoke/mint.
  active.add(key);
  try { return await recover(); }
  finally { active.delete(key); }
}
