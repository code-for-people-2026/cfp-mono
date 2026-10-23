import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "../../src/contracts";
import { IdentityService } from "../../src/identity";
import { openStore, type Store } from "../../src/store";
import { AttachmentService } from "../../src/records/attachments";
import { hash, recordCollections, recordTables } from "../../src/records/persistence";
import { RecordsService } from "../../src/records/service";
import type { DailyMetrics, LegacyActivity, LegacyRecordsBackend, SourceRef } from "../../src/records/types";
import { LegacyFixture, WechatFixture } from "./identity";

function semantic(row: LegacyActivity | null) {
  if (!row) return null;
  const facts = { ...row }; delete facts.createdAt; delete facts.updatedAt;
  return facts;
}

/** Synthetic remote boundary with conditional writes and controllable response loss; sidecar persistence is real SQLite. */
export class RecordsLegacyFixture extends LegacyFixture implements LegacyRecordsBackend {
  activities = new Map<string, LegacyActivity>();
  dailyStats = new Map<string, DailyMetrics>();
  writes: Array<{ babyId: string; id: string; desired: LegacyActivity | null; expected: LegacyActivity | null }> = [];
  committedWrites = 0;
  loseWriteResponseOnce = false;
  failBeforeWriteOnce = false;
  failStatisticsOnce = false;
  private sequence = 0;
  async listActivities(babyId: string) { return [...this.activities.values()].filter(row => row.babyId === babyId).map(row => structuredClone(row)); }
  async getActivity(babyId: string, id: string) {
    const row = this.activities.get(id);
    return row?.babyId === babyId ? structuredClone(row) : null;
  }
  async writeActivity(babyId: string, id: string, desired: LegacyActivity | null, expected: LegacyActivity | null): Promise<LegacyActivity | null> {
    this.writes.push(structuredClone({ babyId, id, desired, expected }));
    if (desired && (desired.babyId !== babyId || desired.id !== id)) throw new AppError(403, "LEGACY_SCOPE_MISMATCH", "Synthetic scope mismatch");
    const current = await this.getActivity(babyId, id);
    if (hash(semantic(current)) === hash(semantic(desired))) return current;
    if (hash(semantic(current)) !== hash(semantic(expected)) || (current && expected?.updatedAt && current.updatedAt !== expected.updatedAt)) throw new AppError(409, "LEGACY_VERSION_CONFLICT", "Synthetic remote edit conflict");
    if (this.failBeforeWriteOnce) { this.failBeforeWriteOnce = false; throw new AppError(502, "LEGACY_UNAVAILABLE", "Synthetic failure before write"); }
    const saved = desired ? { ...structuredClone(desired), updatedAt: new Date(Date.parse("2026-10-23T12:00:00.000Z") + ++this.sequence).toISOString() } : null;
    if (saved) this.activities.set(id, saved); else this.activities.delete(id);
    this.committedWrites++;
    if (this.loseWriteResponseOnce) { this.loseWriteResponseOnce = false; throw new AppError(502, "LEGACY_UNAVAILABLE", "Synthetic committed write with lost response"); }
    return saved ? structuredClone(saved) : null;
  }
  async saveDailyStats(babyId: string, date: string, metrics: DailyMetrics) {
    if (this.failStatisticsOnce) { this.failStatisticsOnce = false; throw new AppError(502, "LEGACY_STATS_UNAVAILABLE", "Synthetic statistics failure"); }
    this.dailyStats.set(`${babyId}:${date}`, structuredClone(metrics));
  }
}

export async function recordsFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "bubu-records-test-"));
  const legacy = new RecordsLegacyFixture(), wechat = new WechatFixture();
  let now = Date.parse("2026-10-23T12:00:00.000Z");
  let store: Store = await openStore({ directory, extensions: recordCollections });
  let identity = new IdentityService(store, legacy, wechat, () => now);
  let attachments = new AttachmentService(identity, { directory });
  let records = new RecordsService(identity, legacy, (scope, req, id) => attachments.validateAttachment(scope, req, id));
  const aliceToken = (await identity.loginLegacy("old-alice", "correct-password", "native")).token;
  const bobToken = (await identity.loginLegacy("old-bob", "correct-password", "native")).token;
  const alice = await identity.authenticate(aliceToken, "bearer"), bob = await identity.authenticate(bobToken, "bearer");
  const operator = await identity.authenticate((await identity.provisionOperator("test-operator", "baby-a", 3_600_000)).token, "bearer");
  for (const name of ["a", "b"]) await identity.bindGroup(operator, "baby-a", `account:group-${name}`, `collector-${name}`, true);
  const collectorA = await identity.authenticate((await identity.issueAgent(operator, "baby-a", "collector", { groupId: "account:group-a", agentId: "collector-a" })).token, "bearer");
  const collectorB = await identity.authenticate((await identity.issueAgent(operator, "baby-a", "collector", { groupId: "account:group-b", agentId: "collector-b" })).token, "bearer");
  return {
    directory, legacy, alice, bob, operator, collectorA, collectorB,
    get store() { return store; }, get identity() { return identity; }, get records() { return records; }, get attachments() { return attachments; },
    advance(ms: number) { now += ms; },
    async resetRecords() {
      await store.transaction(async req => {
        for (const collection of recordTables) await store.payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true, req });
      });
      legacy.activities.clear(); legacy.dailyStats.clear(); legacy.writes = []; legacy.committedWrites = 0;
      legacy.loseWriteResponseOnce = false; legacy.failBeforeWriteOnce = false; legacy.failStatisticsOnce = false;
    },
    async restart() {
      await store.close(); store = await openStore({ directory, extensions: recordCollections });
      identity = new IdentityService(store, legacy, wechat, () => now);
      attachments = new AttachmentService(identity, { directory });
      records = new RecordsService(identity, legacy, (scope, req, id) => attachments.validateAttachment(scope, req, id));
    },
    async close() { await store.close(); await rm(directory, { recursive: true, force: true }); },
  };
}
export type RecordsFixture = Awaited<ReturnType<typeof recordsFixture>>;
export function source(messageId: string, eventKey = "event-0", groupId = "account:group-a"): SourceRef {
  return { kind: "wechat", accountId: "account", conversationId: groupId, messageId, eventKey, sentAt: "2026-10-22T08:00:43+08:00", senderId: "synthetic-sender", groupId };
}
