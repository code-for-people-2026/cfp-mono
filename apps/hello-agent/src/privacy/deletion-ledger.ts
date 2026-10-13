import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
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
  // Persist the file entry and all ancestor entries, including directories
  // concurrently created by another deletion, before database erasure starts.
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
    if (path.dirname(directory) === directory) break;
  }
}

// Bound each record before decoding JSON. Retrying deletions may append the
// same digest many times; callers can deduplicate digests without retaining
// the complete file, lines, timestamps or decoded record objects.
export async function* readDeletionLedger(file: string) {
  const maximumLineBytes = 4096;
  let pending = Buffer.alloc(0);
  const digestOf = (line: Buffer) => {
    if (line.length > maximumLineBytes) throw new Error("删除清单单条记录过大，禁止恢复开放");
    const text = line.toString("utf8").trim();
    if (!text) return undefined;
    try {
      const record: unknown = JSON.parse(text);
      if (record && typeof record === "object" && "ownerDigest" in record && typeof record.ownerDigest === "string" && /^[a-f0-9]{64}$/.test(record.ownerDigest)) return record.ownerDigest;
    } catch { /* Report a bounded diagnostic without exposing ledger content. */ }
    throw new Error("删除清单格式无效，禁止恢复开放");
  };
  for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
    const buffer = Buffer.concat([pending, chunk]);
    let start = 0;
    for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10, start)) {
      const digest = digestOf(buffer.subarray(start, end));
      if (digest) yield digest;
      start = end + 1;
    }
    pending = buffer.subarray(start);
    if (pending.length > maximumLineBytes) throw new Error("删除清单单条记录过大，禁止恢复开放");
  }
  const digest = digestOf(pending);
  if (digest) yield digest;
}
