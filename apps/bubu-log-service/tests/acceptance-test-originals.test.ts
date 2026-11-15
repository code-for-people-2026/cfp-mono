import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CollectorService, type StoredMessage } from "../src/collector/service";
import { hash, recordTables } from "../src/records/persistence";
import type { CareEvent, SourceRef } from "../src/records/types";
import { runAcceptanceTestOriginals, type AcceptanceTestOriginalsManifest } from "../scripts/acceptance-test-originals";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

const babyId = "baby-a";
const operatorId = "phone-feedback-20261115";
const definitions = {
  bottle: { id: "fixture-bottle", key: "bottle-formula-missing-amount", sentAt: "2026-11-15T00:10:00+08:00" },
  sleep: { id: "fixture-sleep", key: "sleep-ended-missing-duration", sentAt: "2026-11-15T00:20:00+08:00" },
  breastfeed: { id: "fixture-breastfeed", key: "breastfeed-ended-missing-duration", sentAt: "2026-11-15T00:30:00+08:00" },
  outdoor: { id: "fixture-outdoor", key: "outdoor-ended-missing-duration", sentAt: "2026-11-15T00:40:00+08:00" },
} as const;
type EventName = keyof typeof definitions;

function manual(name: EventName): SourceRef {
  const definition = definitions[name];
  return { kind: "manual", accountId: `maintenance:${operatorId}`, conversationId: "acceptance-feedback",
    messageId: `acceptance-feedback:${definition.key}`, eventKey: definition.key, sentAt: definition.sentAt, senderId: operatorId };
}

function event(name: EventName, fixture: RecordsFixture): CareEvent {
  const common = {
    id: definitions[name].id, babyId, legacyId: definitions[name].id, version: name === "breastfeed" ? 3 : name === "bottle" || name === "outdoor" ? 2 : 1,
    states: {}, progress: "ended" as const, evidence: [], conflicts: [], lifecycle: "active" as const, duplicateCandidates: [],
    sources: [manual(name)], attachmentIds: [], actor: { kind: "operator" as const, id: operatorId, sessionId: fixture.operator.sessionId },
    projection: "candidate" as const, projected: null, createdAt: "2026-11-14T17:03:26.000Z", updatedAt: "2026-11-14T17:43:06.000Z",
  };
  if (name === "bottle") return { ...common, facts: { type: "BOTTLE", startTime: "2026-11-14T00:00:00.000Z", milkSource: "FORMULA", notes: "[测试记录] 奶粉已喝完，补奶量。" },
    missing: ["milkAmount"], complete: false };
  if (name === "sleep") return { ...common, facts: { type: "SLEEP", endTime: "2026-11-14T16:20:00.000Z", notes: "[测试记录] 睡醒了，补睡眠时长。" },
    missing: ["durationMinutes"], complete: false };
  if (name === "breastfeed") return { ...common, facts: { type: "BREASTFEED", startTime: "2026-11-14T16:10:00.000Z", endTime: "2026-11-14T16:30:00.000Z", durationMinutes: 20, notes: "[测试记录] 亲喂结束。" },
    missing: [], complete: true };
  return { ...common, facts: { type: "OUTDOOR", startTime: "2026-11-14T16:10:00.000Z", endTime: "2026-11-14T16:40:00.000Z", durationMinutes: 30, notes: "[测试记录] 户外回来。" },
    missing: [], complete: true };
}

function manifest(events: Record<EventName, CareEvent>): AcceptanceTestOriginalsManifest {
  return {
    kind: "acceptance-test-originals/v1", babyId, operatorId,
    events: {
      bottle: { eventId: events.bottle.id, expectedVersion: events.bottle.version, eventFingerprint: hash(events.bottle), messages: [
        { senderName: "阿姨（测试）", sentAt: "2026-11-14T00:00:00.000Z", text: "刚给宝宝喂完奶粉。" },
        { senderName: "爸爸（测试）", sentAt: "2026-11-14T00:01:00.000Z", text: "奶瓶已经洗好了。" },
      ] },
      sleep: { eventId: events.sleep.id, expectedVersion: events.sleep.version, eventFingerprint: hash(events.sleep), messages: [
        { senderName: "妈妈（测试）", sentAt: "2026-11-14T16:20:00.000Z", text: "宝宝醒啦，这一觉睡得挺安稳。" },
      ] },
      breastfeed: { eventId: events.breastfeed.id, expectedVersion: events.breastfeed.version, eventFingerprint: hash(events.breastfeed), messages: [
        { senderName: "妈妈（测试）", sentAt: "2026-11-14T16:30:00.000Z", text: "刚亲喂完，宝宝吃饱了。" },
      ] },
      outdoor: { eventId: events.outdoor.id, expectedVersion: events.outdoor.version, eventFingerprint: hash(events.outdoor), messages: [
        { senderName: "爸爸（测试）", sentAt: "2026-11-14T16:40:00.000Z", text: "带宝宝在楼下走了一会儿，刚回家。" },
      ] },
    },
  };
}

describe("acceptance test original-message maintenance", () => {
  let fixture: RecordsFixture;
  let seeded: Record<EventName, CareEvent>;
  beforeAll(async () => { fixture = await recordsFixture(); }, 30_000);
  beforeEach(async () => {
    await fixture.resetRecords();
    await fixture.store.transaction(request => fixture.store.payload.delete({ collection: "audit", where: { key: { contains: "acceptance-test-originals:" } }, overrideAccess: true, req: request }));
    seeded = Object.fromEntries((Object.keys(definitions) as EventName[]).map(name => [name, event(name, fixture)])) as Record<EventName, CareEvent>;
    await fixture.identity.executeAuthorized(fixture.operator, babyId, "records:write", async (_scope, request) => {
      for (const value of Object.values(seeded)) await fixture.records.repo.put("care-events", babyId, value.id, value, request);
    });
  });
  afterAll(async () => { await fixture?.close(); });

  const runtime = () => ({ store: fixture.store, identity: fixture.identity, records: fixture.records });
  async function tableSnapshot() {
    return fixture.identity.executeAuthorized(fixture.alice, babyId, "records:read", async (_scope, request) => Object.fromEntries(await Promise.all(
      recordTables.map(async table => [table, await fixture.records.repo.list(table, babyId, request)]),
    )));
  }

  it("dry-runs without writes, then atomically inserts only retained evidence and a sanitized audit", async () => {
    const before = await tableSnapshot();
    const sessions = (await fixture.store.list("sessions")).length;
    const dry = await runAcceptanceTestOriginals(runtime(), manifest(seeded));
    expect(dry).toMatchObject({ mode: "dry-run", babyId });
    expect(dry.sourceIds).toHaveLength(5);
    expect(await tableSnapshot()).toEqual(before);
    expect((await fixture.store.list("sessions")).length).toBe(sessions);

    await expect(runAcceptanceTestOriginals(runtime(), manifest(seeded), { execute: true, onMutation: () => { throw new Error("synthetic-before-write"); } })).rejects.toThrow("synthetic-before-write");
    expect(await tableSnapshot()).toEqual(before);
    expect((await fixture.store.list("audit")).filter(row => row.key.startsWith("acceptance-test-originals:"))).toHaveLength(0);

    const receipt = await runAcceptanceTestOriginals(runtime(), manifest(seeded), { execute: true });
    expect(receipt.mode).toBe("executed");
    const after = await tableSnapshot();
    for (const table of recordTables) {
      if (table === "care-messages") continue;
      expect(after[table]).toEqual(before[table]);
    }
    expect(after["care-messages"]).toHaveLength(5);
    const audit = (await fixture.store.list("audit")).find(row => row.key.startsWith("acceptance-test-originals:"));
    expect(audit?.value).toMatchObject({ action: "maintenance.acceptance-test-originals", actorKind: "operator", actorId: operatorId, babyId,
      operationFingerprint: receipt.operationFingerprint, eventIds: receipt.eventIds, sourceIds: receipt.sourceIds });
    const serializedAudit = JSON.stringify(audit?.value);
    for (const raw of Object.values(manifest(seeded).events).flatMap(value => value.messages.map(message => message.text))) expect(serializedAudit).not.toContain(raw);

    const collector = new CollectorService(fixture.identity, async () => false);
    await expect(collector.eventSources(fixture.alice, babyId, seeded.bottle.id)).resolves.toMatchObject({
      unavailableCount: 0,
      messages: [
        { kind: "test", label: "测试记录 · 模拟消息", senderName: "阿姨（测试）", sentAt: "2026-11-14T00:00:00.000Z", text: "刚给宝宝喂完奶粉。" },
        { kind: "test", label: "测试记录 · 模拟消息", senderName: "爸爸（测试）", sentAt: "2026-11-14T00:01:00.000Z", text: "奶瓶已经洗好了。" },
      ],
    });
    for (const [name, expected] of [
      ["sleep", "宝宝醒啦，这一觉睡得挺安稳。"],
      ["breastfeed", "刚亲喂完，宝宝吃饱了。"],
      ["outdoor", "带宝宝在楼下走了一会儿，刚回家。"],
    ] as const) {
      await expect(collector.eventSources(fixture.alice, babyId, seeded[name].id)).resolves.toMatchObject({
        unavailableCount: 0, messages: [{ kind: "test", label: "测试记录 · 模拟消息", text: expected }],
      });
    }
    await expect(collector.eventSources(fixture.operator, babyId, seeded.bottle.id)).rejects.toMatchObject({ code: "RECORD_SOURCES_CAREGIVER_REQUIRED" });
  });

  it("is an exact replay no-op after restart and rejects changed or stale manifests", async () => {
    const input = manifest(seeded);
    const first = await runAcceptanceTestOriginals(runtime(), input, { execute: true });
    await fixture.restart();
    const second = await runAcceptanceTestOriginals(runtime(), input, { execute: true });
    expect(second).toEqual({ ...first, mode: "noop" });
    expect((await fixture.store.list("audit")).filter(row => row.key.startsWith("acceptance-test-originals:"))).toHaveLength(1);

    const changed = structuredClone(input);
    changed.events.outdoor.messages[0]!.text = "另一段模拟原文。";
    await expect(runAcceptanceTestOriginals(runtime(), changed, { execute: true })).rejects.toThrow("OPERATION_FINGERPRINT_MISMATCH");

    const stale = structuredClone(input);
    stale.events.sleep.expectedVersion += 1;
    await expect(runAcceptanceTestOriginals(runtime(), stale)).rejects.toThrow("TEST_EVENT_EXPECTATION_MISMATCH:sleep");
  });

  it("does not rehydrate retained-away or deleted originals", async () => {
    const input = manifest(seeded);
    const receipt = await runAcceptanceTestOriginals(runtime(), input, { execute: true });
    await fixture.identity.executeAuthorized(fixture.operator, babyId, "records:write", async (_scope, request) => {
      const stored = await fixture.records.repo.get<StoredMessage>("care-messages", babyId, receipt.sourceIds[0]!, request);
      await fixture.records.repo.put("care-messages", babyId, receipt.sourceIds[0]!, { ...stored!, privacyExpired: true, source: { ...stored!.source, text: "" } }, request);
    });
    await expect(runAcceptanceTestOriginals(runtime(), input, { execute: true })).resolves.toMatchObject({ mode: "noop" });
    const collector = new CollectorService(fixture.identity, async () => false);
    await expect(collector.eventSources(fixture.alice, babyId, seeded.bottle.id)).resolves.toMatchObject({
      unavailableCount: 1, messages: [{ text: null }, { text: "奶瓶已经洗好了。" }],
    });

    await fixture.store.transaction(async request => {
      await fixture.store.payload.delete({ collection: "care-messages", where: { key: { equals: receipt.sourceIds[1] } }, overrideAccess: true, req: request });
    });
    await expect(runAcceptanceTestOriginals(runtime(), input, { execute: true })).rejects.toThrow("ORIGINAL_EVIDENCE_MISSING");
    expect(await fixture.store.payload.count({ collection: "care-messages", where: { babyId: { equals: babyId } }, overrideAccess: true })).toMatchObject({ totalDocs: 4 });
  });
});
