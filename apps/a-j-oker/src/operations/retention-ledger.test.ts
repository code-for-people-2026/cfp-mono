import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmedRetentionLedger, readRetentionLedger, retentionLedgerPath, retentionRecord, writeRetentionLedger } from "./retention-ledger";
import { purgeExpiredEvidence, replayRetentionLedger } from "./retention";
import type { Payload, PayloadRequest } from "payload";

afterEach(() => vi.unstubAllEnvs());

describe("independent safety retention ledger", () => {
  it("derives a sibling path without exposing receipt or owner text", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "safety-retention-ledger-"));
    try {
      vi.stubEnv("HELLO_PRIVACY_DELETION_LEDGER", path.join(directory, "deletions.ndjson"));
      const record = retentionRecord({ id: 7, receipt: "private-receipt", revision: 3, retainUntil: "2026-11-20T00:00:00.000Z", retentionReviewNeeded: true, legalHold: false, holdReviewAt: null }, "purge");
      await writeRetentionLedger(record);
      expect(retentionLedgerPath()).toBe(path.join(directory, "safety-retention.ndjson"));
      const raw = await readFile(retentionLedgerPath()!, "utf8");
      expect(raw).not.toContain("private-receipt");
      expect(raw).not.toContain("owner");
      const records = [];
      for await (const value of readRetentionLedger()) records.push(value);
      expect(records).toEqual([record]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("replays only a matching intent and post-commit confirmation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "safety-retention-confirmed-"));
    try {
      const file = path.join(directory, "ledger.ndjson"), operationId = randomUUID();
      const row = { id: 8, receipt: "private-receipt", revision: 4, retainUntil: "2026-12-20T00:00:00.000Z", retentionReviewNeeded: false, legalHold: true, holdReviewAt: "2026-11-30T00:00:00.000Z" };
      await writeFile(file, [
        JSON.stringify(retentionRecord(row, "state_intent", operationId)),
        JSON.stringify(retentionRecord(row, "state_commit", operationId)),
      ].join("\n") + "\n");
      const confirmed = [];
      for await (const value of confirmedRetentionLedger(file)) confirmed.push(value);
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0]).toMatchObject({ event: "state_commit", operationId, revision: 4, legalHold: true });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["rolled-back state update", "commit-boundary confirmation failure"])("fails closed for an unresolved intent from %s", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "safety-retention-ambiguous-"));
    try {
      const file = path.join(directory, "ledger.ndjson"), operationId = randomUUID();
      const row = { id: 9, receipt: "private-receipt", revision: 5, retainUntil: "2026-12-20T00:00:00.000Z", retentionReviewNeeded: false, legalHold: false, holdReviewAt: null };
      await writeFile(file, [
        JSON.stringify(retentionRecord({ ...row, id: 8 }, "purge")),
        JSON.stringify(retentionRecord(row, "state_intent", operationId)),
      ].join("\n") + "\n");
      let exposed = 0;
      const read = async () => { for await (const ignored of confirmedRetentionLedger(file)) { void ignored; exposed++; } };
      await expect(read()).rejects.toThrow("未确认状态");
      expect(exposed).toBe(0);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("fails closed on malformed or overlong restore records", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "safety-retention-invalid-"));
    try {
      const file = path.join(directory, "ledger.ndjson");
      for (const value of ["{broken", "x".repeat(4097)]) {
        await writeFile(file, value);
        const read = async () => { for await (const ignored of readRetentionLedger(file)) void ignored; };
        await expect(read()).rejects.toThrow("禁止恢复开放");
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("skips only a proven 404 during restore and blocks other database failures", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "safety-retention-restore-read-"));
    try {
      const file = path.join(directory, "ledger.ndjson");
      await writeFile(file, JSON.stringify(retentionRecord({ id: 10, receipt: "private-receipt", revision: 1, retainUntil: null, retentionReviewNeeded: false, legalHold: false, holdReviewAt: null }, "purge")) + "\n");
      vi.stubEnv("HELLO_SAFETY_RETENTION_LEDGER", file);
      const req = {} as PayloadRequest;
      const missing = { findByID: vi.fn().mockRejectedValue({ status: 404 }) } as unknown as Payload;
      await expect(replayRetentionLedger(missing, req)).resolves.toEqual({ records: 1, states: 0, purges: 0 });
      const unavailable = { findByID: vi.fn().mockRejectedValue(new Error("database unavailable")) } as unknown as Payload;
      await expect(replayRetentionLedger(unavailable, req)).rejects.toThrow("禁止恢复开放");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects ledger replay in dry-run before opening a transaction", async () => {
    const payload = { find: vi.fn(), update: vi.fn() } as unknown as Payload;
    await expect(purgeExpiredEvidence(payload, false, new Date(), { replayLedger: true })).rejects.toThrow("必须显式启用执行模式");
    expect(payload.find).not.toHaveBeenCalled();
    expect(payload.update).not.toHaveBeenCalled();
  });
});
