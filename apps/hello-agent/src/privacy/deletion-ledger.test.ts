import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deletionLedgerPath, writeDeletionLedger } from "./deletion-ledger";
import { privacyPolicy } from "./policy";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "   ", "ledger.ndjson", "./data/ledger.ndjson", "/", "/persistent/"])("无效清单路径不能开放处理，也不会创建文件：%j", async (file) => {
  for (const [key, value] of Object.entries({
    HELLO_PRIVACY_CONTACT: "test@example.invalid", HELLO_PRIVACY_RESPONSE_DAYS: "7", HELLO_PRIVACY_STORAGE_LOCATION: "隔离测试", HELLO_PRIVACY_RETENTION_DAYS: "30", HELLO_PRIVACY_BACKUP_DAYS: "7", HELLO_PRIVACY_OPERATIONS_APPROVED: "true",
  })) vi.stubEnv(key, value);
  vi.stubEnv("HELLO_PRIVACY_DELETION_LEDGER", file);
  expect(privacyPolicy().ready).toBe(false);
  await expect(writeDeletionLedger("isolated-owner")).rejects.toMatchObject({ status: 503 });
});
it("绝对路径去除配置空白后用于实际持久写入，清单只含身份摘要和时间", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "privacy-ledger-unit-"));
  try {
    const file = path.join(directory, "independent", "deletions.ndjson");
    vi.stubEnv("HELLO_PRIVACY_DELETION_LEDGER", `  ${file} \n`);
    expect(deletionLedgerPath()).toBe(file);
    await writeDeletionLedger("isolated-owner");
    const record = JSON.parse((await readFile(file, "utf8")).trim());
    expect(record).toEqual({ ownerDigest: createHash("sha256").update("isolated-owner").digest("hex"), requestedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(record.requestedAt))).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("显式恢复路径中的空字节被拒绝", () => {
  expect(deletionLedgerPath("/persistent/ledger\0.ndjson")).toBeUndefined();
});

it.each(["{", "null", '{"ownerDigest":"bad"}', "x".repeat(4097)])("流式恢复拒绝损坏或超长记录（case %#）", async (record) => {
  const { writeFile } = await import("node:fs/promises");
  const { readDeletionLedger } = await import("./deletion-ledger");
  const directory = await mkdtemp(path.join(os.tmpdir(), "privacy-ledger-invalid-"));
  try {
    const file = path.join(directory, "ledger.ndjson"); await writeFile(file, record);
    await expect((async () => { for await (const digest of readDeletionLedger(file)) void digest; })()).rejects.toThrow("禁止恢复开放");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
it("流式读取支持跨块记录、CRLF、空行和没有末尾换行的大量重复项", async () => {
  const { open } = await import("node:fs/promises");
  const { readDeletionLedger } = await import("./deletion-ledger");
  const directory = await mkdtemp(path.join(os.tmpdir(), "privacy-ledger-stream-"));
  try {
    const file = path.join(directory, "ledger.ndjson");
    const a = "a".repeat(64), b = "b".repeat(64);
    const row = JSON.stringify({ ownerDigest: a, requestedAt: "2026-10-13" }) + "\r\n\n";
    const handle = await open(file, "w");
    try {
      for (let chunk = 0; chunk < 500; chunk++) await handle.write(row.repeat(100));
      await handle.write(JSON.stringify({ ownerDigest: b }));
    } finally { await handle.close(); }
    const unique = new Set<string>(); let count = 0;
    for await (const digest of readDeletionLedger(file)) { count++; unique.add(digest); }
    expect(count).toBe(50_001);
    expect([...unique]).toEqual([a, b]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
