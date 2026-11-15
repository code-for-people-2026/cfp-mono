import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { sourceFingerprint, type SourceMessage } from "../src/collector/types";
import { hash, recordTables } from "../src/records/persistence";
import type { CareEvent, SourceRef } from "../src/records/types";
import { runAcceptanceFeedback } from "../scripts/acceptance-feedback";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

const babyId = "baby-a";
const groupId = "account:group-a";
const targetId = "bubu-synthetic-wrong-270";
const targetSource: SourceMessage = {
  sourceId: "wechat:synthetic-target", accountId: "account", groupId, chatId: groupId,
  databaseId: "message/message_0.db", tableName: "Msg_synthetic", localId: 1873,
  sentAt: "2026-10-23T00:00:43.000Z", senderId: "sender-exact", kind: "text",
  text: "喝奶羊奶 200ml 奶粉 70ml", media: [],
};
const targetRef: SourceRef = {
  kind: "wechat", accountId: targetSource.accountId, conversationId: targetSource.chatId,
  messageId: `${targetSource.databaseId}/${targetSource.tableName}/${targetSource.localId}`,
  eventKey: "wechat-1873-feeding:0", sentAt: targetSource.sentAt,
  senderId: targetSource.senderId!, groupId,
};
const profiles = [
  { senderId: "sender-ann", senderName: "测试照护者甲", senderAvatarUrl: "https://wx.qlogo.cn/mmhead/test-ann/132" },
  { senderId: targetSource.senderId!, senderName: "测试照护者乙", senderAvatarUrl: "https://wx.qlogo.cn/mmhead/test-situ/132" },
  { senderId: "sender-warm", senderName: "测试照护者丙", senderAvatarUrl: "https://wx.qlogo.cn/mmhead/test-warm/132" },
];
const additionalSources: SourceMessage[] = [
  { ...targetSource, sourceId: "wechat:synthetic-1846", localId: 1846, sentAt: "2026-10-22T23:30:00.000Z", text: "晚上喝奶200羊奶150奶粉" },
  { ...targetSource, sourceId: "wechat:synthetic-ann", localId: 1801, senderId: "sender-ann", sentAt: "2026-10-22T23:31:00.000Z", text: "普通消息" },
  { ...targetSource, sourceId: "wechat:synthetic-warm", localId: 1802, senderId: "sender-warm", sentAt: "2026-10-22T23:32:00.000Z", text: "普通消息" },
];

function manifest() {
  return {
    kind: "acceptance-feedback/v1",
    babyId,
    operatorId: "acceptance-feedback-operator",
    target: {
      eventId: targetId, expectedVersion: 1, sourceId: targetSource.sourceId,
      sourceFingerprint: hash(sourceFingerprint(targetSource)), text: targetSource.text,
      sentAt: targetSource.sentAt, accountId: targetSource.accountId, groupId,
      chatId: targetSource.chatId, messageId: targetRef.messageId,
      eventKey: targetRef.eventKey, senderId: targetSource.senderId,
    },
    profiles,
    collector: { agentId: "collector-a" },
    formulaEventKey: "wechat-1873-feeding:1",
    testChinaDate: "2026-10-23",
    testRecords: [
      { key: "bottle-formula-missing-amount", name: "配方奶缺少奶量", sentAt: "2026-10-23T01:00:00.000Z" },
      { key: "sleep-ended-missing-duration", name: "睡眠缺少时长", sentAt: "2026-10-23T02:00:00.000Z" },
      { key: "breastfeed-ended-missing-duration", name: "亲喂缺少时长", sentAt: "2026-10-23T03:00:00.000Z" },
      { key: "outdoor-ended-missing-duration", name: "户外缺少时长", sentAt: "2026-10-23T04:00:00.000Z" },
    ],
    requests: {
      repairOriginal: "acceptance-repair-original-v1",
      createFormula: "acceptance-create-formula-v1",
      resolveFormulaDistinct: "acceptance-formula-distinct-v1",
      confirmFormulaOverlap: "acceptance-formula-overlap-v1",
      seedTests: "acceptance-seed-tests-v1",
    },
  };
}

async function runtime(fixture: RecordsFixture) {
  return { store: fixture.store, identity: fixture.identity, records: fixture.records };
}

async function seed(fixture: RecordsFixture) {
  const now = "2026-10-23T00:10:00.000Z";
  const event: CareEvent = {
    id: targetId, babyId, legacyId: targetId, version: 1,
    facts: { milkAmount: 270, notes: "错误合计270ml，喂养方式和时间待确认。" },
    states: { type: "pending", startTime: "pending", milkAmount: "known", milkSource: "pending", notes: "known" },
    progress: "unknown", missing: ["type", "startTime"], conflicts: [], complete: false, evidence: [],
    lifecycle: "active", duplicateCandidates: [], sources: [targetRef], attachmentIds: [],
    actor: { kind: "collector", id: "collector-a", sessionId: fixture.collectorA.sessionId },
    projection: "candidate", projected: null, createdAt: now, updatedAt: now,
  };
  const untouched1846: CareEvent = {
    ...structuredClone(event), id: "bubu-untouched-1846", legacyId: "bubu-untouched-1846",
    facts: { notes: "晚上喝奶200羊奶150奶粉；未明确单位，保持待补。" },
    sources: [{ ...targetRef, messageId: `${additionalSources[0]!.databaseId}/${additionalSources[0]!.tableName}/${additionalSources[0]!.localId}`, eventKey: "wechat-1846-feeding:0", sentAt: additionalSources[0]!.sentAt }],
  };
  await fixture.identity.executeAuthorized(fixture.collectorA, babyId, "records:write", async (_scope, request) => {
    await fixture.records.repo.put("care-events", babyId, event.id, event, request);
    await fixture.records.repo.put("care-events", babyId, untouched1846.id, untouched1846, request);
    await fixture.records.repo.put("care-messages", babyId, targetSource.sourceId, {
      source: targetSource, contentHash: hash(sourceFingerprint(targetSource)), state: "processed", batchId: "synthetic-batch",
    }, request);
    for (const source of additionalSources) await fixture.records.repo.put("care-messages", babyId, source.sourceId, {
      source, contentHash: hash(sourceFingerprint(source)), state: "processed", batchId: "synthetic-batch",
    }, request);
  }, groupId);
}

async function careSnapshot(fixture: RecordsFixture) {
  return fixture.identity.executeAuthorized(fixture.alice, babyId, "records:read", async (_scope, request) => Object.fromEntries(await Promise.all(
    recordTables.map(async table => [table, await fixture.records.repo.list(table, babyId, request)]),
  )));
}

describe("offline acceptance-feedback maintenance", () => {
  let fixture: RecordsFixture;
  beforeAll(async () => { fixture = await recordsFixture(); }, 30_000);
  beforeEach(async () => {
    await fixture.resetRecords();
    await fixture.store.transaction(request => fixture.store.payload.delete({ collection: "audit", where: { key: { contains: "acceptance-feedback:profiles:" } }, overrideAccess: true, req: request }));
    await seed(fixture);
  });
  afterAll(async () => { await fixture?.close(); });

  it("retires dry-run before identity minting, callbacks, or writes", async () => {
    const before = await careSnapshot(fixture);
    const sessionsBefore = await fixture.store.list("sessions");
    const mint = vi.spyOn(fixture.identity, "provisionOperator");
    const mutation = vi.fn();
    await expect(runAcceptanceFeedback(await runtime(fixture), manifest(), { onMutation: mutation })).rejects.toThrow("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
    expect(mint).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect(await fixture.store.list("sessions")).toEqual(sessionsBefore);
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
    mint.mockRestore();
  });

  it("retires execute attempts even with drifted manifests and leaves all data unchanged", async () => {
    const before = await careSnapshot(fixture);
    const mutation = vi.fn();
    const wrongVersion = manifest(); wrongVersion.target.expectedVersion = 2;
    await expect(runAcceptanceFeedback(await runtime(fixture), wrongVersion, { execute: true, onMutation: mutation })).rejects.toThrow("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
    const wrongFingerprint = manifest(); wrongFingerprint.target.sourceFingerprint = "0".repeat(64);
    await expect(runAcceptanceFeedback(await runtime(fixture), wrongFingerprint, { execute: true, onMutation: mutation })).rejects.toThrow("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
    expect(mutation).not.toHaveBeenCalled();
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
  });

  it("retires restart or resume attempts without creating operations or events", async () => {
    const before = await careSnapshot(fixture);
    await expect(runAcceptanceFeedback(await runtime(fixture), manifest(), { execute: true })).rejects.toThrow("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
    await fixture.restart();
    await expect(runAcceptanceFeedback(await runtime(fixture), manifest(), { execute: true })).rejects.toThrow("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
    expect(await careSnapshot(fixture)).toEqual(before);
    expect(fixture.legacy.committedWrites).toBe(0);
  });

  it("retires the CLI before reading its manifest or creating a data directory", () => {
    const dataDirectory = path.join(fixture.directory, "retired-feedback-cli-data");
    const missingManifest = path.join(fixture.directory, "manifest-must-not-be-read.json");
    const result = spawnSync(path.resolve("node_modules/.bin/tsx"), ["scripts/acceptance-feedback.ts", "--execute", "--manifest", missingManifest], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, BUBU_IDENTITY_DIRECTORY: dataDirectory },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ACCEPTANCE_FEEDBACK_RETIRED_ONE_MEAL_MODEL");
    expect(result.stderr).not.toContain("ENOENT");
    expect(existsSync(dataDirectory)).toBe(false);
  }, 15_000);
});
