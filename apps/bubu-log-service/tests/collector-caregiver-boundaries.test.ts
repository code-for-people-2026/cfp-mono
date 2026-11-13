import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { EventInput } from "../src/records/types";
import { agentPlanSchema } from "../src/collector/service";
import { recordsFixture, source, type RecordsFixture } from "./fixtures/records";

const day = "2026-10-22";
const at = (hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00+08:00`;
const bottle = (hour = 8): EventInput => ({
  facts: { type: "BOTTLE", startTime: at(hour), durationMinutes: 10, milkSource: "BREAST_MILK", milkAmount: 80, burpSuccess: true },
});

describe("collector authorization requires caregivers for destructive-history reversals", () => {
  let fixture: RecordsFixture;
  beforeAll(async () => { fixture = await recordsFixture(); }, 30_000);
  beforeEach(async () => { await fixture.resetRecords(); });
  afterAll(async () => { await fixture?.close(); });

  it("keeps ordinary collector record, answer, update, attach and retract paths available", async () => {
    const pendingEvent = { ...bottle() }; delete pendingEvent.facts.burpSuccess;
    const candidate = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "ordinary-collector-record", events: [{ ...pendingEvent, sources: [source("ordinary-record")] }] });
    const question = candidate.questions[0]!;
    const answered = await fixture.records.answer(fixture.collectorA, { babyId: "baby-a", requestId: "ordinary-collector-answer", questionId: question.id, questionVersion: question.version, eventVersion: question.eventVersion, patch: { facts: { burpSuccess: true } }, sources: [source("ordinary-answer")] });
    expect(answered.status).toBe("saved");

    const updated = await fixture.records.update(fixture.collectorA, { babyId: "baby-a", requestId: "ordinary-collector-update", eventId: answered.events[0]!.id, expectedVersion: answered.events[0]!.version, patch: { facts: { notes: "群内补充说明" } }, sources: [source("ordinary-update")] });
    expect(updated.status).toBe("saved");

    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ddeeff" } }).png().toBuffer();
    const photoSource = source("ordinary-photo");
    const attachment = await fixture.attachments.upload(fixture.collectorA, "baby-a", bytes, "image/png", "ordinary-collector-attachment", photoSource);
    const attached = await fixture.records.attach(fixture.collectorA, { babyId: "baby-a", requestId: "ordinary-collector-attach", eventId: updated.events[0]!.id, expectedVersion: updated.events[0]!.version, attachmentIds: [attachment.id] });
    expect(attached.events[0]?.attachmentIds).toEqual([attachment.id]);

    const retracted = await fixture.records.retract(fixture.collectorA, { babyId: "baby-a", requestId: "ordinary-collector-retract", eventId: attached.events[0]!.id, expectedVersion: attached.events[0]!.version });
    expect(retracted.events[0]?.lifecycle).toBe("retracted");
    expect(await fixture.legacy.listActivities("baby-a")).toEqual([]);
  });

  it("rejects collector restore and undo of a caregiver deletion before persistence", async () => {
    const recorded = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "collector-record-before-retract", events: [{ ...bottle(), sources: [source("protected-record")] }] });
    const event = recorded.events[0]!;
    const retracted = await fixture.records.retract(fixture.alice, { babyId: "baby-a", requestId: "caregiver-retract", eventId: event.id, expectedVersion: event.version });
    const tombstone = retracted.events[0]!;
    expect(tombstone.lifecycle).toBe("retracted");

    await expect(fixture.records.retract(fixture.collectorA, { babyId: "baby-a", requestId: "collector-restore-denied", eventId: tombstone.id, expectedVersion: tombstone.version }, true))
      .rejects.toMatchObject({ code: "CAREGIVER_REQUIRED", status: 403 });
    const deletionRevision = (await fixture.records.revisions(fixture.collectorA, "baby-a", tombstone.id)).find(revision => revision.version === tombstone.version)!;
    await expect(fixture.records.undo(fixture.collectorA, { babyId: "baby-a", requestId: "collector-undo-denied", eventId: tombstone.id, expectedVersion: tombstone.version, revisionId: deletionRevision.id }))
      .rejects.toMatchObject({ code: "CAREGIVER_REQUIRED", status: 403 });

    const unchanged = (await fixture.records.query(fixture.collectorA, { babyId: "baby-a", eventId: tombstone.id, includeRetracted: true })).events[0]!;
    expect(unchanged).toMatchObject({ id: tombstone.id, version: tombstone.version, lifecycle: "retracted" });
    expect(unchanged.sources).toEqual([source("protected-record")]);
    expect(await fixture.legacy.listActivities("baby-a")).toEqual([]);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(0);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(0);

    const undone = await fixture.records.undo(fixture.alice, { babyId: "baby-a", requestId: "caregiver-undo-deletion", eventId: unchanged.id, expectedVersion: unchanged.version, revisionId: deletionRevision.id });
    expect(undone.events[0]).toMatchObject({ lifecycle: "active", version: tombstone.version + 1 });
    const retractedAgain = await fixture.records.retract(fixture.alice, { babyId: "baby-a", requestId: "caregiver-retract-again", eventId: undone.events[0]!.id, expectedVersion: undone.events[0]!.version });
    const restored = await fixture.records.retract(fixture.alice, { babyId: "baby-a", requestId: "caregiver-restore", eventId: retractedAgain.events[0]!.id, expectedVersion: retractedAgain.events[0]!.version }, true);
    expect(restored.events[0]).toMatchObject({ lifecycle: "active", version: retractedAgain.events[0]!.version + 1 });
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(80);
  });

  it("rejects both collector duplicate resolutions without changing the candidate or statistics", async () => {
    const original = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "duplicate-original", events: [{ ...bottle(), sources: [source("duplicate-source-1")] }] })).events[0]!;
    const candidate = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "duplicate-candidate", events: [{ ...bottle(), sources: [source("duplicate-source-2")] }] })).events[0]!;
    expect(candidate.duplicateCandidates).toEqual([original.id]);
    expect(candidate.projection).toBe("candidate");

    await expect(fixture.records.resolveDuplicate(fixture.collectorA, { babyId: "baby-a", requestId: "collector-distinct-denied", eventId: candidate.id, expectedVersion: candidate.version, resolution: "distinct" }))
      .rejects.toMatchObject({ code: "CAREGIVER_REQUIRED", status: 403 });
    await expect(fixture.records.resolveDuplicate(fixture.collectorA, { babyId: "baby-a", requestId: "collector-same-denied", eventId: candidate.id, expectedVersion: candidate.version, resolution: "same", targetEventId: original.id, targetVersion: original.version }))
      .rejects.toMatchObject({ code: "CAREGIVER_REQUIRED", status: 403 });

    const unchanged = (await fixture.records.query(fixture.collectorA, { babyId: "baby-a", eventId: candidate.id })).events[0]!;
    expect(unchanged).toMatchObject({ id: candidate.id, version: candidate.version, projection: "candidate" });
    expect(unchanged.duplicateCandidates).toEqual([original.id]);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(80);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(80);

    const distinct = await fixture.records.resolveDuplicate(fixture.alice, { babyId: "baby-a", requestId: "caregiver-distinct", eventId: candidate.id, expectedVersion: candidate.version, resolution: "distinct" });
    expect(distinct.events[0]).toMatchObject({ lifecycle: "active", version: candidate.version + 1 });
    expect(distinct.events[0]?.duplicateCandidates).toEqual([]);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(160);
  });

  it("lets a caregiver merge same-group duplicates after collector confirmation is denied", async () => {
    const original = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "merge-original", events: [{ ...bottle(), sources: [source("merge-source-1")] }] })).events[0]!;
    const candidate = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "merge-candidate", events: [{ ...bottle(), sources: [source("merge-source-2")] }] })).events[0]!;
    await expect(fixture.records.resolveDuplicate(fixture.collectorA, { babyId: "baby-a", requestId: "collector-merge-denied", eventId: candidate.id, expectedVersion: candidate.version, resolution: "same", targetEventId: original.id, targetVersion: original.version }))
      .rejects.toMatchObject({ code: "CAREGIVER_REQUIRED", status: 403 });

    const merged = await fixture.records.resolveDuplicate(fixture.alice, { babyId: "baby-a", requestId: "caregiver-merge", eventId: candidate.id, expectedVersion: candidate.version, resolution: "same", targetEventId: original.id, targetVersion: original.version });
    expect(merged.events).toHaveLength(2);
    expect(merged.events[0]).toMatchObject({ lifecycle: "merged", mergedInto: original.id });
    expect(merged.events[1]?.sources).toEqual(expect.arrayContaining([source("merge-source-1"), source("merge-source-2")]));
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(80);
  });

  it("removes restore, undo and duplicate confirmation from the collector plan schema", () => {
    for (const tool of ["bubu_restore_event", "bubu_undo_event", "bubu_resolve_duplicate"]) {
      expect(() => agentPlanSchema.parse({ plans: [{ key: "forbidden", sourceIds: ["bound-source"], tool, arguments: {} }], ignored: [] })).toThrow();
    }
  });
});
