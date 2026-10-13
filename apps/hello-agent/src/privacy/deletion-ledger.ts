import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../domain/contracts";

// An absolute path is a configuration prerequisite, not proof that the volume
// is persistent. Operations must still verify its storage and independent backup.
export function deletionLedgerPath(value = process.env.HELLO_PRIVACY_DELETION_LEDGER) {
  const file = value?.trim();
  return file && path.isAbsolute(file) && !file.includes("\0") && !file.endsWith(path.sep) ? file : undefined;
}
export async function writeDeletionLedger(owner: string) {
  const file = deletionLedgerPath();
  if (!file) throw new AppError(503, "删除清单须配置独立持久文件的绝对路径，数据已冻结，请联系管理员完成删除");
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, "a", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ ownerDigest: createHash("sha256").update(owner).digest("hex"), requestedAt: new Date().toISOString() }) + "\n");
    await handle.sync();
  } finally { await handle.close(); }
}
