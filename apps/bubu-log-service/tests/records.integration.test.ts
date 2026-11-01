import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { activityTypes, type EventInput } from "../src/records/types";
import { recordsFixture, source, type RecordsFixture } from "./fixtures/records";

const day = "2026-10-22";
const at = (hour: number, minute = 0) => `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
const bottle = (hour = 8, milkAmount = 100): EventInput => ({ facts: { type: "BOTTLE", startTime: at(hour), durationMinutes: 10, milkSource: "BREAST_MILK", milkAmount, burpSuccess: true } });
const exercise = (hour = 9): EventInput => ({ facts: { type: "ROLL_OVER", startTime: at(hour), count: 2 } });

describe("care records persist intent, legacy projections and recovery in one sidecar", () => {
  let fixture: RecordsFixture;
  beforeAll(async () => { fixture = await recordsFixture(); }, 30_000);
  beforeEach(async () => { await fixture.resetRecords(); });
  afterAll(async () => { await fixture?.close(); });

  it("persists all 15 activity types and projects only unchanged legacy fields", async () => {
    const events: EventInput[] = activityTypes.map((type, index) => {
      const facts: EventInput["facts"] = { type, startTime: at(1 + index), notes: `合成${type}` };
      if (["BREASTFEED", "BOTTLE", "PUMP", "SLEEP", "HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION"].includes(type)) facts.durationMinutes = 10;
      if (type === "BREASTFEED") Object.assign(facts, { burpSuccess: false, breastFirmness: "SOFT" });
      if (type === "BOTTLE") Object.assign(facts, { milkSource: "FORMULA", milkAmount: 100, preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true, burpSuccess: true });
      if (type === "PUMP") facts.milkAmount = 60;
      if (type === "DIAPER") Object.assign(facts, { hasPoop: true, hasPee: true, poopColor: "YELLOW", peeAmount: "MEDIUM" });
      if (type === "ROLL_OVER" || type === "PULL_TO_SIT") facts.count = 3;
      if (type === "SUPPLEMENT") facts.supplementType = "D3";
      if (type === "SPIT_UP") facts.spitUpType = "PROJECTILE";
      return { facts };
    });
    const result = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "all-fifteen", events });
    expect(result.status).toBe("saved"); expect(result.questions).toHaveLength(0); expect(result.events).toHaveLength(15);
    expect(result.events.every(event => event.complete && event.projection === "synced")).toBe(true);
    const legacy = await fixture.legacy.listActivities("baby-a"); expect(legacy).toHaveLength(15);
    expect(new Set(legacy.map(row => row.type))).toEqual(new Set(activityTypes));
    for (const row of legacy) for (const metadata of ["preparedMilkAmount", "remainingMilkAmount", "sameBottle", "durationMinutes", "sources", "states"]) expect(row).not.toHaveProperty(metadata);
    const summary = await fixture.records.summary(fixture.alice, "baby-a", day);
    expect(summary?.metrics).toMatchObject({ totalMilkAmount: 100, totalPumpMilkAmount: 60, totalSleepMinutes: 10, breastfeedCount: 1, diaperCount: 1, poopCount: 1, peeCount: 1, supplementD3Count: 1, projectileSpitUpCount: 1 });
    expect(summary?.byType.BOTTLE?.preparedMilkAmount).toBe(120);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)).toEqual(summary?.metrics);
  });

  it("keeps known zero, unknown values, incomplete facts and unclassified candidates distinct", async () => {
    const zero = bottle(8, 0), unknown = bottle(10); delete unknown.facts.milkAmount; unknown.states = { milkAmount: "unknown" };
    const incomplete = bottle(12); delete incomplete.facts.burpSuccess;
    const result = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "known-unknown-pending", events: [zero, unknown, incomplete, { facts: { notes: "喂了一点，方式和时间都没记清" }, intent: "feeding" }] });
    expect(result.status).toBe("needs_information"); expect(result.events[0]?.facts.milkAmount).toBe(0);
    expect(result.events[1]?.facts).not.toHaveProperty("milkAmount"); expect(result.events[1]?.states.milkAmount).toBe("unknown");
    expect(result.events[2]?.projection).toBe("synced"); expect(result.events[3]?.projection).toBe("candidate");
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(3);
    const questions = await fixture.records.pending(fixture.alice, "baby-a");
    expect(questions.find(q => q.eventId === result.events[2]!.id)?.fields).toContain("burpSuccess");
    expect(questions.find(q => q.eventId === result.events[1]!.id)).toBeUndefined();
    const summary = await fixture.records.summary(fixture.alice, "baby-a", day);
    expect(summary?.metrics.totalMilkAmount).toBe(100);
    expect(summary?.coverage).toMatchObject({ knownMilkAmounts: 2, unknownMilkAmounts: 1, knownZeroMilkAmounts: 1, unresolvedTime: 1 });
    await fixture.restart();
    const query = await fixture.records.query(fixture.alice, { babyId: "baby-a" });
    expect(query.events).toHaveLength(4); expect(query.questions).toHaveLength(2);
  });

  it("answers the durable question on the original event and refreshes both query and saved statistics", async () => {
    const partial = bottle(); delete partial.facts.milkAmount;
    const original = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "missing-amount", events: [{ ...partial, sources: [source("100")] }] });
    const question = original.questions[0]!, event = original.events[0]!;
    const answer = await fixture.records.answer(fixture.collectorA, { babyId: "baby-a", requestId: "group-follow-up", questionId: question.id, questionVersion: question.version, eventVersion: event.version,
      patch: { facts: { milkAmount: 90 } }, sources: [source("101")] });
    expect(answer.status).toBe("saved"); expect(answer.events[0]?.id).toBe(event.id); expect(answer.events[0]?.legacyId).toBe(event.legacyId);
    expect(answer.events[0]?.sources.map(value => value.messageId)).toEqual(["100", "101"]);
    expect(await fixture.records.pending(fixture.alice, "baby-a")).toHaveLength(0);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(90);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(90);
    await expect(fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "stale-answer", questionId: question.id, questionVersion: question.version, eventVersion: event.version, patch: { facts: { milkAmount: 120 } } })).rejects.toMatchObject({ code: "QUESTION_STALE" });
  });

  it("completes an unclassified candidate without a second event, then closes group questions through ordinary correction", async () => {
    const candidate = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "unclassified-source", events: [{ facts: { notes: "刚刚吃过" }, intent: "feeding", sources: [source("110")] }] });
    const event = candidate.events[0]!, question = candidate.questions[0]!;
    expect(event.projection).toBe("candidate"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    const classified = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "classify-feeding", questionId: question.id, questionVersion: question.version, eventVersion: event.version,
      patch: { facts: { type: "BOTTLE", startTime: at(8), durationMinutes: 10, milkSource: "FORMULA", preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true } } });
    expect(classified.events[0]?.id).toBe(event.id); expect(classified.events[0]?.facts.milkAmount).toBe(100);
    expect(classified.events[0]?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ field: "milkAmount", kind: "calculated", confirmed: true })]));
    expect(classified.questions[0]?.fields).toEqual(["burpSuccess"]);
    const finished = await fixture.records.update(fixture.collectorA, { babyId: "baby-a", requestId: "later-group-supplement", eventId: event.id, expectedVersion: classified.events[0]!.version,
      patch: { facts: { burpSuccess: false } }, sources: [source("111")] });
    expect(finished.status).toBe("saved"); expect(await fixture.records.pending(fixture.alice, "baby-a")).toHaveLength(0);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1); expect(finished.events[0]?.id).toBe(event.id);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(100);
  });

  it("moves a corrected event to another date and refreshes the old and new persisted daily totals", async () => {
    const original = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "date-correction-start", events: [bottle()] })).events[0]!;
    const result = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "date-correction-move", eventId: original.id, expectedVersion: original.version,
      patch: { facts: { startTime: "2026-10-21T08:00:00+08:00", endTime: "2026-10-21T08:15:00+08:00", milkAmount: 120 } } });
    expect(result.status).toBe("saved"); expect(result.events[0]?.facts.durationMinutes).toBe(15);
    expect((await fixture.records.query(fixture.alice, { babyId: "baby-a", date: day })).events).toHaveLength(0);
    expect((await fixture.records.query(fixture.alice, { babyId: "baby-a", date: "2026-10-21" })).events[0]?.id).toBe(original.id);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(0);
    expect(fixture.legacy.dailyStats.get("baby-a:2026-10-21")?.totalMilkAmount).toBe(120);
    expect((await fixture.records.summary(fixture.alice, "baby-a", "2026-10-21"))?.metrics.totalMilkAmount).toBe(120);
  });

  it("projects a real overlap only after caregiver confirmation and reopens it when the other event's time changes", async () => {
    const sleep = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "confirmed-overlap-sleep", events: [{ facts: { type: "SLEEP", startTime: at(8), durationMinutes: 60 } }] })).events[0]!;
    const head = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "confirmed-overlap-head", events: [{ facts: { type: "HEAD_LIFT", startTime: at(8, 15), durationMinutes: 10 }, sources: [source("overlap-head")] }] })).events[0]!;
    expect(head.projection).toBe("candidate"); expect(head.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ code: "TIME_OVERLAP", relatedEventId: sleep.id })]));
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
    const confirmation = { babyId: "baby-a", requestId: "confirmed-overlap-human", eventId: head.id, expectedVersion: head.version, conflictingEventIds: [sleep.id], reason: "家长核对当时确有短时抬头，保留两个事实" };
    await expect(fixture.records.confirmOverlap(fixture.collectorA, confirmation)).rejects.toMatchObject({ code: "CAREGIVER_REQUIRED", status: 403 });
    const accepted = await fixture.records.confirmOverlap(fixture.alice, confirmation), confirmed = accepted.events[0]!;
    expect(accepted.status).toBe("saved"); expect(confirmed.projection).toBe("synced"); expect(confirmed.conflicts).toEqual([]);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(2);
    expect((await fixture.records.revisions(fixture.alice, "baby-a", head.id)).find(revision => revision.version === confirmed.version)?.after.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ confirmed: true, detail: expect.stringContaining(confirmation.reason) })]));
    const oldSleep = fixture.legacy.activities.get(sleep.legacyId)!;
    fixture.legacy.activities.set(sleep.legacyId, { ...oldSleep, endTime: at(9, 30), updatedAt: "2026-10-23T12:03:00Z" });
    const changed = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "confirmed-overlap-recheck", eventId: head.id, expectedVersion: confirmed.version, patch: { facts: { notes: "再次核对" } } });
    expect(changed.status).toBe("needs_information"); expect(changed.events[0]?.projection).toBe("candidate");
    expect(changed.questions[0]?.conflicts.some(issue => issue.code === "TIME_OVERLAP")).toBe(true);
    const reconfirmed = await fixture.records.confirmOverlap(fixture.alice, { ...confirmation, requestId: "confirmed-overlap-again", expectedVersion: changed.events[0]!.version });
    expect(reconfirmed.status).toBe("saved"); expect(await fixture.records.pending(fixture.alice, "baby-a")).toHaveLength(0);
  });

  it("checks a newly classified candidate against existing bottles before projecting or counting it", async () => {
    const original = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "candidate-duplicate-original", events: [bottle()] })).events[0]!;
    const candidate = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "candidate-duplicate-pending", events: [{ facts: { milkAmount: 100 }, states: { startTime: "unknown" }, intent: "feeding" }] });
    const pending = candidate.questions[0]!;
    const answer = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "candidate-duplicate-answer", questionId: pending.id, questionVersion: pending.version, eventVersion: pending.eventVersion, patch: bottle() });
    expect(answer.events[0]?.id).toBe(candidate.events[0]?.id);
    expect(answer.events[0]?.duplicateCandidates).toEqual([original.id]); expect(answer.events[0]?.projection).toBe("candidate");
    expect(answer.status).toBe("needs_information"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(100);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(100);
  });

  it("replaces unconfirmed image evidence with an explicit textual answer and resolves the question", async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "yellow" } }).png({ compressionLevel: 9 }).toBuffer();
    const attachment = await fixture.attachments.upload(fixture.alice, "baby-a", bytes, "image/png", "image-color-evidence");
    const candidate = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "unconfirmed-poop-photo", events: [{
      facts: { type: "DIAPER", startTime: at(8), hasPoop: true, hasPee: false, poopColor: "YELLOW" }, attachmentIds: [attachment.id],
      evidence: [{ field: "poopColor", kind: "image", detail: "unconfirmed visual color", confirmed: false }],
    }] });
    expect(candidate.events[0]?.facts).not.toHaveProperty("poopColor"); expect(candidate.events[0]?.states.poopColor).toBe("pending");
    const pending = candidate.questions[0]!;
    const answer = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "human-confirmed-yellow", questionId: pending.id, questionVersion: pending.version, eventVersion: pending.eventVersion,
      patch: { facts: { poopColor: "YELLOW" } } });
    expect(answer.status).toBe("saved"); expect(answer.events[0]?.facts.poopColor).toBe("YELLOW");
    expect(answer.events[0]?.evidence.some(item => item.field === "poopColor" && item.kind === "image" && !item.confirmed)).toBe(false);
    expect(answer.events[0]?.attachmentIds).toEqual([attachment.id]); expect(await fixture.records.pending(fixture.alice, "baby-a")).toHaveLength(0);
    expect((await fixture.legacy.listActivities("baby-a"))[0]?.poopColor).toBe("YELLOW");
  });

  it("distinguishes ongoing sleep from an ended sleep with a missing end and retains cross-midnight totals", async () => {
    const result = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "sleep-states", events: [
      { facts: { type: "SLEEP", startTime: at(18) }, progress: "ongoing" },
      { facts: { type: "SLEEP", startTime: at(20) }, progress: "ended" },
      { facts: { type: "SLEEP", startTime: at(23, 30), endTime: "2026-10-23T00:30:00+08:00" } },
    ] });
    expect(result.events[0]?.states.endTime).toBe("not_yet");
    expect(result.questions.some(q => q.eventId === result.events[0]?.id)).toBe(false);
    expect(result.questions.find(q => q.eventId === result.events[1]?.id)?.fields).toContain("endTime");
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalSleepMinutes).toBe(30);
    expect((await fixture.records.summary(fixture.alice, "baby-a", "2026-10-23"))?.metrics.totalSleepMinutes).toBe(30);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalSleepMinutes).toBe(30);
    expect(fixture.legacy.dailyStats.get("baby-a:2026-10-23")?.totalSleepMinutes).toBe(30);
  });

  it("keeps confirmed ongoing sleep visible after midnight and restart until waking completes each day's minutes", async () => {
    const previousNow = fixture.identity.now();
    try {
      fixture.advance(Date.parse("2026-10-23T23:30:00+08:00") - previousNow);
      const event = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "overnight-sleep", events: [{ facts: { type: "SLEEP", startTime: "2026-10-23T23:30:00+08:00" }, progress: "ongoing" }] })).events[0]!;
      fixture.legacy.activities.set("unconfirmed-old-sleep", { id: "unconfirmed-old-sleep", babyId: "baby-a", type: "SLEEP", startTime: "2026-10-23T21:00:00+08:00" });
      fixture.advance(3_600_000);
      await fixture.restart();
      const ongoing = await fixture.records.query(fixture.alice, { babyId: "baby-a", date: "2026-10-24" });
      expect(ongoing.events.map(value => value.id)).toEqual([event.id]);
      expect(ongoing.activities.map(value => value.id)).toEqual([event.legacyId]);
      expect(ongoing.summary?.coverage).toMatchObject({ recordedEvents: 1, ongoingEvents: 1 });
      expect(ongoing.summary?.byType.SLEEP).toMatchObject({ ongoingEvents: 1, knownMinutes: 0, unknownDurations: 0 });
      expect(ongoing.summary?.metrics).toMatchObject({ sleepCount: 0, totalSleepMinutes: 0 });
      fixture.advance(1_800_000);
      const completed = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "overnight-woke", eventId: event.id, expectedVersion: event.version, patch: { facts: { endTime: "2026-10-24T01:00:00+08:00" }, progress: "ended" } });
      expect(completed.status).toBe("saved"); expect(completed.events[0]?.id).toBe(event.id);
      for (const [date, minutes] of [["2026-10-23", 30], ["2026-10-24", 60]] as const) {
        const summary = await fixture.records.summary(fixture.alice, "baby-a", date);
        expect(summary?.metrics).toMatchObject({ sleepCount: 1, totalSleepMinutes: minutes });
        expect(summary?.coverage.ongoingEvents).toBe(0);
        expect(fixture.legacy.dailyStats.get(`baby-a:${date}`)?.totalSleepMinutes).toBe(minutes);
      }
    } finally { fixture.advance(previousNow - fixture.identity.now()); }
  });

  it("maps multiple messages to one event and one message to separate events without collapsing identical messages", async () => {
    const result = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "multi-source-batch", events: [
      { ...bottle(8), sources: [source("200"), source("201")] },
      { ...exercise(9), sources: [source("202", "roll")] },
      { facts: { type: "DIAPER", startTime: at(9), hasPoop: false, hasPee: true, peeAmount: "SMALL" }, sources: [source("202", "diaper")] },
      { ...exercise(11), sources: [source("203")] },
      { ...exercise(11), sources: [source("204")] },
    ] });
    expect(result.events).toHaveLength(5); expect(new Set(result.events.map(event => event.id)).size).toBe(5);
    expect(result.events[0]?.sources).toHaveLength(2);
    expect(result.events[4]?.duplicateCandidates).toContain(result.events[3]!.id);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(4);
    const replay = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "different-retry-request", events: [{ ...bottle(8), sources: [source("201")] }] });
    expect(replay.events[0]?.id).toBe(result.events[0]!.id);
    expect((await fixture.records.query(fixture.alice, { babyId: "baby-a" })).events).toHaveLength(5);
  });

  it("does not count possible duplicates until explicit distinct resolution and merges sources for same-event resolution", async () => {
    const first = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "original-bottle", events: [bottle()] })).events[0]!;
    const second = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "group-duplicate", events: [{ ...bottle(), sources: [source("300")] }] })).events[0]!;
    expect(second.duplicateCandidates).toEqual([first.id]); expect(second.projection).toBe("candidate");
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(100);
    const distinct = await fixture.records.resolveDuplicate(fixture.alice, { babyId: "baby-a", requestId: "confirm-distinct", eventId: second.id, expectedVersion: second.version, resolution: "distinct" });
    expect(distinct.status).toBe("saved"); expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(200);
    const third = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "another-copy", events: [{ ...bottle(), sources: [source("301")] }] })).events[0]!;
    const merged = await fixture.records.resolveDuplicate(fixture.alice, { babyId: "baby-a", requestId: "confirm-same", eventId: third.id, expectedVersion: third.version, resolution: "same", targetEventId: first.id, targetVersion: first.version });
    expect(merged.events.find(event => event.id === third.id)?.lifecycle).toBe("merged");
    expect(merged.events.find(event => event.id === first.id)?.sources[0]?.messageId).toBe("301");
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(200);
    const replay = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "replay-merged", events: [{ ...bottle(), sources: [source("301")] }] });
    expect(replay.events[0]?.lifecycle).toBe("merged"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(2);
  });

  it("replays an identical request without adding facts, and deleted sources remain tombstoned after restart", async () => {
    const input = { babyId: "baby-a", requestId: "original-source", events: [{ ...bottle(), sources: [source("400")] }] };
    const original = await fixture.records.record(fixture.collectorA, input);
    expect(await fixture.records.record(fixture.collectorA, input)).toEqual(original);
    await expect(fixture.records.record(fixture.collectorA, { ...input, events: [{ ...bottle(8, 120), sources: [source("400")] }] })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const event = original.events[0]!;
    const removed = await fixture.records.retract(fixture.alice, { babyId: "baby-a", requestId: "delete-source", eventId: event.id, expectedVersion: event.version });
    expect(removed.events[0]?.lifecycle).toBe("retracted"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    await fixture.restart();
    const replay = await fixture.records.record(fixture.collectorA, { ...input, requestId: "late-replay-source" });
    expect(replay.events[0]?.id).toBe(event.id); expect(replay.events[0]?.lifecycle).toBe("retracted");
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(0);
    const restored = await fixture.records.retract(fixture.alice, { babyId: "baby-a", requestId: "explicit-restore", eventId: event.id, expectedVersion: replay.events[0]!.version }, true);
    expect(restored.events[0]?.legacyId).toBe(event.legacyId); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
  });

  it("recovers a committed remote write with a lost response after restart, without duplication", async () => {
    fixture.legacy.loseWriteResponseOnce = true;
    const input = { babyId: "baby-a", requestId: "lost-response", events: [bottle()] };
    const interrupted = await fixture.records.record(fixture.alice, input);
    expect(interrupted.status).toBe("pending_projection"); expect(interrupted.retryable).toBe(true);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1); expect(fixture.legacy.committedWrites).toBe(1);
    await fixture.restart();
    const saved = await fixture.records.getRequest(fixture.alice, { babyId: "baby-a", requestId: input.requestId, retry: true });
    expect(saved.status).toBe("saved"); expect(saved.events[0]?.id).toBe(interrupted.events[0]?.id);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1); expect(fixture.legacy.committedWrites).toBe(1);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(100);
  });

  it("keeps a pending request retryable until saved statistics catch up", async () => {
    fixture.legacy.failStatisticsOnce = true;
    const pending = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "stats-failure", events: [bottle()] });
    expect(pending.status).toBe("pending_projection"); expect(pending.events[0]?.projection).toBe("synced");
    const recovered = await fixture.records.getRequest(fixture.alice, { babyId: "baby-a", requestId: "stats-failure", retry: true });
    expect(recovered.status).toBe("saved"); expect(fixture.legacy.committedWrites).toBe(1);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(100);
  });

  it("does not reconcile a still-pending projection into a deletion that its original journal can later replay", async () => {
    fixture.legacy.failBeforeWriteOnce = true;
    const pending = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "pending-before-write", events: [bottle()] });
    const event = pending.events[0]!; expect(pending.status).toBe("pending_projection"); expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    await expect(fixture.records.reconcile(fixture.alice, { babyId: "baby-a", requestId: "premature-accept-absence", eventId: event.id, expectedVersion: event.version })).rejects.toMatchObject({ code: "PROJECTION_PENDING" });
    const recovered = await fixture.records.getRequest(fixture.alice, { babyId: "baby-a", requestId: pending.requestId, retry: true });
    expect(recovered.status).toBe("saved"); expect(recovered.events[0]?.lifecycle).toBe("active");
  });

  it("does not let an older statistics retry mark a newer pending correction as projected", async () => {
    fixture.legacy.failStatisticsOnce = true;
    const original = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "older-stats-pending", events: [bottle()] });
    expect(original.status).toBe("pending_projection"); const event = original.events[0]!; expect(event.projection).toBe("synced");
    fixture.legacy.failBeforeWriteOnce = true;
    const correction = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "newer-write-pending", eventId: event.id, expectedVersion: event.version, patch: { facts: { milkAmount: 110 } } });
    expect(correction.status).toBe("pending_projection"); expect(correction.events[0]?.projection).toBe("pending");
    expect(fixture.legacy.activities.get(event.legacyId)?.milkAmount).toBe(100);
    await fixture.records.getRequest(fixture.alice, { babyId: "baby-a", requestId: original.requestId, retry: true });
    const stillPending = (await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: event.id })).events[0]!;
    expect(stillPending.projection).toBe("pending"); expect(stillPending.facts.milkAmount).toBe(110);
    const recovered = await fixture.records.getRequest(fixture.alice, { babyId: "baby-a", requestId: correction.requestId, retry: true });
    expect(recovered.status).toBe("saved"); expect(recovered.events[0]?.facts.milkAmount).toBe(110);
    expect(fixture.legacy.activities.get(event.legacyId)?.milkAmount).toBe(110);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(110);
  });

  it("rejects stale concurrent edits and supports undo of the latest revision", async () => {
    const original = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "concurrent-start", events: [bottle()] })).events[0]!;
    const edits = await Promise.allSettled([110, 120].map(milkAmount => fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: `concurrent-${milkAmount}`, eventId: original.id, expectedVersion: original.version, patch: { facts: { milkAmount } } })));
    expect(edits.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter(result => result.status === "rejected")).toHaveLength(1);
    const rejected = edits.find(result => result.status === "rejected"); expect(rejected?.status === "rejected" && rejected.reason.code).toBe("VERSION_CONFLICT");
    const current = (await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: original.id })).events[0]!;
    const revisions = await fixture.records.revisions(fixture.alice, "baby-a", original.id);
    expect(revisions).toHaveLength(2);
    const reverted = await fixture.records.undo(fixture.alice, { babyId: "baby-a", requestId: "undo-latest", eventId: current.id, expectedVersion: current.version, revisionId: revisions.find(value => value.version === current.version)!.id });
    expect(reverted.events[0]?.facts.milkAmount).toBe(100); expect(reverted.events[0]?.version).toBe(3);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(100);
    expect(fixture.legacy.dailyStats.get(`baby-a:${day}`)?.totalMilkAmount).toBe(100);
  });

  it("detects an old-site concurrent edit without overwriting it and explicitly reconciles the newest fact", async () => {
    const original = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "legacy-conflict-start", events: [bottle()] })).events[0]!;
    const old = fixture.legacy.activities.get(original.legacyId)!;
    fixture.legacy.activities.set(old.id, { ...old, milkAmount: 130, updatedAt: "2026-10-23T12:01:00.000Z" });
    const conflict = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "stale-remote-write", eventId: original.id, expectedVersion: original.version, patch: { facts: { milkAmount: 110 } } });
    expect(conflict.status).toBe("conflict"); expect(fixture.legacy.activities.get(old.id)?.milkAmount).toBe(130);
    expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.metrics.totalMilkAmount).toBe(130);
    const current = conflict.events[0]!;
    const reconciled = await fixture.records.reconcile(fixture.alice, { babyId: "baby-a", requestId: "accept-old-site", eventId: current.id, expectedVersion: current.version });
    expect(reconciled.status).toBe("saved"); expect(reconciled.events[0]?.facts.milkAmount).toBe(130);
  });

  it("preserves applicable preparation metadata when accepting newer original-backend fields", async () => {
    const input = bottle(); Object.assign(input.facts, { milkSource: "FORMULA", preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true });
    const original = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "formula-metadata-start", events: [input] })).events[0]!;
    const old = fixture.legacy.activities.get(original.legacyId)!;
    fixture.legacy.activities.set(old.id, { ...old, notes: "旧站补充的备注", updatedAt: "2026-10-23T12:02:00Z" });
    const conflict = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "formula-metadata-conflict", eventId: original.id, expectedVersion: original.version, patch: { facts: { notes: "本地备注" } } });
    expect(conflict.status).toBe("conflict");
    const reconciled = await fixture.records.reconcile(fixture.alice, { babyId: "baby-a", requestId: "formula-metadata-reconcile", eventId: original.id, expectedVersion: conflict.events[0]!.version });
    expect(reconciled.events[0]?.facts).toMatchObject({ notes: "旧站补充的备注", milkAmount: 100, preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true });
    expect(reconciled.status).toBe("saved"); expect((await fixture.records.summary(fixture.alice, "baby-a", day))?.byType.BOTTLE?.preparedMilkAmount).toBe(120);
  });

  it("rejects cross-baby writes and private attachment association, and rolls back the failed batch", async () => {
    const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png({ compressionLevel: 9 }).toBuffer();
    const attachment = await fixture.attachments.upload(fixture.bob, "baby-b", photo, "image/png", "bob-image");
    await expect(fixture.records.record(fixture.alice, { babyId: "baby-b", requestId: "wrong-baby", events: [bottle()] })).rejects.toMatchObject({ status: 403 });
    await expect(fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "foreign-attachment", events: [exercise(8), { ...bottle(10), attachmentIds: [attachment.id] }] })).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    expect((await fixture.records.query(fixture.alice, { babyId: "baby-a" })).events).toHaveLength(0);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(0);
    const own = await fixture.attachments.upload(fixture.alice, "baby-a", photo, "image/png", "alice-image");
    const event = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "own-event", events: [exercise()] })).events[0]!;
    expect((await fixture.records.attach(fixture.alice, { babyId: "baby-a", requestId: "attach-own", eventId: event.id, expectedVersion: event.version, attachmentIds: [own.id] })).events[0]?.attachmentIds).toEqual([own.id]);
  });

  it("requires the same media write permission for initial attachment association and later attachment changes", async () => {
    const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png({ compressionLevel: 9 }).toBuffer();
    const attachment = await fixture.attachments.upload(fixture.alice, "baby-a", photo, "image/png", "permission-photo");
    const login = await fixture.identity.loginWechat("fixture:read-media-only:nonce");
    const restricted = await fixture.identity.authenticate(login.token, "bearer");
    await fixture.identity.setGrant(fixture.operator, "baby-a", restricted.subjectId, "active", ["records:read", "records:write", "media:read"]);
    expect((await fixture.attachments.read(restricted, "baby-a", attachment.id)).bytes).toEqual(photo);
    await expect(fixture.records.record(restricted, { babyId: "baby-a", requestId: "initial-attachment-denied", events: [{ ...exercise(), attachmentIds: [attachment.id] }] })).rejects.toMatchObject({ status: 403 });
    const event = (await fixture.records.record(restricted, { babyId: "baby-a", requestId: "no-attachment-allowed", events: [exercise()] })).events[0]!;
    await expect(fixture.records.attach(restricted, { babyId: "baby-a", requestId: "later-attachment-denied", eventId: event.id, expectedVersion: event.version, attachmentIds: [attachment.id] })).rejects.toMatchObject({ status: 403 });
  });

  it("requires media write permission when undo would restore removed image associations", async () => {
    const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png({ compressionLevel: 9 }).toBuffer();
    const attachment = await fixture.attachments.upload(fixture.alice, "baby-a", photo, "image/png", "undo-permission-photo");
    const original = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "undo-permission-original", events: [{ ...exercise(), attachmentIds: [attachment.id] }] })).events[0]!;
    const removed = (await fixture.records.attach(fixture.alice, { babyId: "baby-a", requestId: "undo-permission-remove", eventId: original.id, expectedVersion: original.version, attachmentIds: [] })).events[0]!;
    const revisions = await fixture.records.revisions(fixture.alice, "baby-a", original.id);
    const login = await fixture.identity.loginWechat("fixture:read-media-undo:nonce"); const restricted = await fixture.identity.authenticate(login.token, "bearer");
    await fixture.identity.setGrant(fixture.operator, "baby-a", restricted.subjectId, "active", ["records:read", "records:write", "media:read"]);
    await expect(fixture.records.undo(restricted, { babyId: "baby-a", requestId: "undo-attachment-denied", eventId: original.id, expectedVersion: removed.version, revisionId: revisions.find(revision => revision.version === removed.version)!.id })).rejects.toMatchObject({ status: 403 });
    expect((await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: original.id })).events[0]?.attachmentIds).toEqual([]);
  });

  it("does not let a collector read or mutate an event sourced only from a different bound group", async () => {
    const event = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "group-a-event", events: [{ ...bottle(), sources: [source("500")] }] })).events[0]!;
    await expect(fixture.records.update(fixture.collectorB, { babyId: "baby-a", requestId: "group-b-forged-edit", eventId: event.id, expectedVersion: event.version, patch: { facts: { milkAmount: 500 } }, sources: [source("501", "event-0", "account:group-b")] })).rejects.toMatchObject({ status: 403 });
    expect((await fixture.records.query(fixture.collectorB, { babyId: "baby-a" })).events).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: event.id })]));
    await expect(fixture.records.revisions(fixture.collectorB, "baby-a", event.id)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps the same chat message's source link independent for two authorized babies", async () => {
    const sharedSource = { kind: "chat" as const, accountId: "family-account", conversationId: "family-chat", messageId: "both-babies-fed", eventKey: "bottle", sentAt: at(8), senderId: "caregiver" };
    const first = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "shared-message-baby-a", events: [{ ...bottle(), sources: [sharedSource] }] });
    const second = await fixture.records.record(fixture.bob, { babyId: "baby-b", requestId: "shared-message-baby-b", events: [{ ...bottle(), sources: [sharedSource] }] });
    expect(first.status).toBe("saved"); expect(second.status).toBe("saved");
    expect(second.events[0]?.id).not.toBe(first.events[0]?.id);
    const replay = await fixture.records.record(fixture.bob, { babyId: "baby-b", requestId: "shared-message-baby-b-replay", events: [{ ...bottle(), sources: [sharedSource] }] });
    expect(replay.events[0]?.id).toBe(second.events[0]?.id);
    expect((await fixture.records.query(fixture.alice, { babyId: "baby-a" })).events.map(value => value.id)).toEqual([first.events[0]!.id]);
    expect((await fixture.records.query(fixture.bob, { babyId: "baby-b" })).events.map(value => value.id)).toEqual([second.events[0]!.id]);
  });

  it("namespaces idempotency by bound group even when one subscribed agent serves both groups", async () => {
    await fixture.identity.bindGroup(fixture.operator, "baby-a", "account:shared-a", "same-agent", true);
    await fixture.identity.bindGroup(fixture.operator, "baby-a", "account:shared-b", "same-agent", true);
    const sharedA = await fixture.identity.authenticate((await fixture.identity.issueAgent(fixture.operator, "baby-a", "collector", { groupId: "account:shared-a", agentId: "same-agent" })).token, "bearer");
    const sharedB = await fixture.identity.authenticate((await fixture.identity.issueAgent(fixture.operator, "baby-a", "collector", { groupId: "account:shared-b", agentId: "same-agent" })).token, "bearer");
    const first = await fixture.records.record(sharedA, { babyId: "baby-a", requestId: "same-request-in-two-groups", events: [{ ...bottle(8), sources: [source("600", "event-0", "account:shared-a")] }] });
    await expect(fixture.records.getRequest(sharedB, { babyId: "baby-a", requestId: "same-request-in-two-groups" })).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
    const second = await fixture.records.record(sharedB, { babyId: "baby-a", requestId: "same-request-in-two-groups", events: [{ ...bottle(10), sources: [source("601", "event-0", "account:shared-b")] }] });
    expect(second.events[0]?.id).not.toBe(first.events[0]?.id); expect(second.status).toBe("saved");
  });

  it("rechecks current source scope when a receipt's event was later merged with another group's source", async () => {
    const first = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "receipt-group-a", events: [{ ...bottle(), sources: [source("700")] }] })).events[0]!;
    const second = (await fixture.records.record(fixture.collectorB, { babyId: "baby-a", requestId: "receipt-group-b", events: [{ ...bottle(), sources: [source("701", "event-0", "account:group-b")] }] })).events[0]!;
    await fixture.records.resolveDuplicate(fixture.alice, { babyId: "baby-a", requestId: "merge-across-entry-sources", eventId: second.id, expectedVersion: second.version, resolution: "same", targetEventId: first.id, targetVersion: first.version });
    const receipt = await fixture.records.getRequest(fixture.collectorA, { babyId: "baby-a", requestId: "receipt-group-a" }).catch(error => {
      expect(error).toMatchObject({ status: 403 }); return { events: [] };
    });
    expect(receipt.events.every(event => event.sources.every(value => value.kind !== "wechat" || value.groupId === "account:group-a"))).toBe(true);
  });
});
