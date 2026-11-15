import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { SafetyCase } from "../payload-types";

export type RetentionLedgerRecord = {
  version: 1;
  caseId: number | string;
  receiptDigest: string;
  revision: number;
  event: "state_intent" | "state_commit" | "purge";
  operationId: string | null;
  recordedAt: string;
  retainUntil: string | null;
  retentionReviewNeeded: boolean;
  legalHold: boolean;
  holdReviewAt: string | null;
};

export function retentionLedgerPath(value = process.env.HELLO_SAFETY_RETENTION_LEDGER) {
  const configured = value?.trim();
  if (configured && path.isAbsolute(configured) && !configured.includes("\0") && !configured.endsWith(path.sep)) return configured;
  const deletion = process.env.HELLO_PRIVACY_DELETION_LEDGER?.trim();
  if (!deletion || !path.isAbsolute(deletion) || deletion.includes("\0") || deletion.endsWith(path.sep)) return undefined;
  return path.join(path.dirname(deletion), "safety-retention.ndjson");
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function retentionRecord(row: Pick<SafetyCase, "id" | "receipt" | "revision" | "retainUntil" | "retentionReviewNeeded" | "legalHold" | "holdReviewAt">, event: RetentionLedgerRecord["event"], operationId: string | null = null): RetentionLedgerRecord {
  if ((event === "purge") !== (operationId === null)) throw new Error("留存状态记录缺少唯一操作编号");
  return {
    version: 1,
    caseId: row.id,
    receiptDigest: digest(String(row.receipt)),
    revision: Number(row.revision),
    event,
    operationId,
    recordedAt: new Date().toISOString(),
    retainUntil: row.retainUntil ? String(row.retainUntil) : null,
    retentionReviewNeeded: Boolean(row.retentionReviewNeeded),
    legalHold: Boolean(row.legalHold),
    holdReviewAt: row.holdReviewAt ? String(row.holdReviewAt) : null,
  };
}

export async function writeRetentionLedger(record: RetentionLedgerRecord) {
  const file = retentionLedgerPath();
  if (!file) {
    if (process.env.HELLO_DEPLOYED === "true") throw new Error("安全证据留存清单不可用，禁止修改留存状态");
    return;
  }
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const handle = await open(file, "a", 0o600);
  try {
    await handle.writeFile(JSON.stringify(record) + "\n");
    await handle.sync();
  } finally { await handle.close(); }
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
    if (path.dirname(directory) === directory) break;
  }
}

function parseRecord(line: Buffer): RetentionLedgerRecord | undefined {
  if (line.length > 4096) throw new Error("安全证据留存清单单条记录过大，禁止恢复开放");
  const text = line.toString("utf8").trim();
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<RetentionLedgerRecord>;
    const caseId = value.caseId;
    const validId = (typeof caseId === "number" && Number.isSafeInteger(caseId) && caseId > 0) || (typeof caseId === "string" && /^[1-9]\d*$/.test(caseId));
    const validDate = (date: unknown) => date === null || (typeof date === "string" && Number.isFinite(Date.parse(date)));
    const validOperationId = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
    if (value.version === 1 && validId && typeof value.receiptDigest === "string" && /^[a-f0-9]{64}$/.test(value.receiptDigest)
      && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && ["state_intent", "state_commit", "purge"].includes(String(value.event))
      && (value.event === "purge" ? value.operationId === null : validOperationId(value.operationId))
      && typeof value.recordedAt === "string" && Number.isFinite(Date.parse(value.recordedAt)) && validDate(value.retainUntil) && typeof value.retentionReviewNeeded === "boolean"
      && typeof value.legalHold === "boolean" && validDate(value.holdReviewAt)) return value as RetentionLedgerRecord;
  } catch { /* Emit only a bounded diagnostic. */ }
  throw new Error("安全证据留存清单格式无效，禁止恢复开放");
}

export async function* readRetentionLedger(file = retentionLedgerPath()) {
  if (!file) throw new Error("恢复前必须配置独立安全证据留存清单");
  let pending = Buffer.alloc(0);
  let total = 0;
  for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
    total += chunk.length;
    if (total > 32 * 1024 * 1024) throw new Error("安全证据留存清单过大，禁止恢复开放");
    const buffer = Buffer.concat([pending, chunk]);
    let start = 0;
    for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10, start)) {
      const record = parseRecord(buffer.subarray(start, end));
      if (record) yield record;
      start = end + 1;
    }
    pending = buffer.subarray(start);
    if (pending.length > 4096) throw new Error("安全证据留存清单单条记录过大，禁止恢复开放");
  }
  const record = parseRecord(pending);
  if (record) yield record;
}

export async function* confirmedRetentionLedger(file = retentionLedgerPath()) {
  const intents = new Map<string, RetentionLedgerRecord>();
  const confirmed: RetentionLedgerRecord[] = [];
  for await (const record of readRetentionLedger(file)) {
    if (record.event === "purge") { confirmed.push(record); continue; }
    const operationId = record.operationId!;
    if (record.event === "state_intent") {
      if (intents.has(operationId)) throw new Error("安全证据留存清单包含重复状态意图，禁止恢复开放");
      intents.set(operationId, record);
      continue;
    }
    const intent = intents.get(operationId);
    if (!intent) throw new Error("安全证据留存清单包含无意图的状态确认，禁止恢复开放");
    const comparable = (value: RetentionLedgerRecord) => ({ ...value, event: "state", recordedAt: "", operationId: "" });
    if (JSON.stringify(comparable(intent)) !== JSON.stringify(comparable(record)))
      throw new Error("安全证据留存清单状态确认不匹配，禁止恢复开放");
    intents.delete(operationId);
    confirmed.push(record);
  }
  if (intents.size) throw new Error("安全证据留存清单存在未确认状态，禁止恢复开放");
  // Do not expose even an earlier valid purge/state record until the whole
  // file has proved complete. Otherwise an unresolved tail could be detected
  // only after a caller had already mutated the restored database.
  for (const record of confirmed) yield record;
}

export function receiptMatches(row: Pick<SafetyCase, "receipt">, record: RetentionLedgerRecord) {
  return digest(String(row.receipt)) === record.receiptDigest;
}
