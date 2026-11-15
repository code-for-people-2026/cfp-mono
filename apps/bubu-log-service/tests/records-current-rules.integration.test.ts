import { beforeEach, afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PendingQuestion } from "../src/records/types";
import { recordsFixture, source, type RecordsFixture } from "./fixtures/records";

const day = "2026-10-22";
const at = (hour: number, minute = 0) => `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;

describe("current record rules reconcile durable questions without rewriting facts", () => {
  let fixture: RecordsFixture;

  beforeAll(async () => {
    fixture = await recordsFixture();
  }, 30_000);
  beforeEach(async () => {
    await fixture.resetRecords();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it("hides an obsolete optional-only question and keeps a mixed question answerable", async () => {
    const complete = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "current-complete-bottle", events: [{
      facts: { type: "BOTTLE", startTime: at(8), durationMinutes: 10, milkItems: [{ id: "complete-milk", milkSource: "BREAST_MILK", milkAmount: 100 }] },
    }] });
    const completeEvent = complete.events[0]!;
    const completeQuestion: PendingQuestion = {
      id: `question:${completeEvent.id}`, babyId: "baby-a", eventId: completeEvent.id, version: 7, eventVersion: completeEvent.version,
      fields: ["burpSuccess"], conflicts: [], duplicateCandidates: [], state: "open", updatedAt: completeEvent.updatedAt,
    };
    await fixture.store.transaction(async req => {
      await fixture.records.repo.put("care-questions", "baby-a", completeQuestion.id, completeQuestion, req);
    });

    const partial = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "current-missing-milk", events: [{
      facts: { type: "BOTTLE", startTime: at(9), durationMinutes: 10, milkItems: [{ id: "partial-milk", milkSource: "BREAST_MILK" }] },
    }] });
    const event = partial.events[0]!;
    const originalQuestion = partial.questions[0]!;
    const mixedQuestion: PendingQuestion = { ...originalQuestion, version: 7, fields: ["milkAmount", "burpSuccess"] };
    await fixture.store.transaction(async req => {
      await fixture.records.repo.put("care-questions", "baby-a", mixedQuestion.id, mixedQuestion, req);
    });

    const writes = fixture.legacy.writes.length;
    const projected = structuredClone(event.projected);
    const query = await fixture.records.query(fixture.alice, { babyId: "baby-a", date: day });
    const pending = await fixture.records.pending(fixture.alice, "baby-a");
    expect(query.events.map(current => current.id).sort()).toEqual([completeEvent.id, event.id].sort());
    expect(query.questions).toEqual([expect.objectContaining({ id: mixedQuestion.id, version: 7, eventVersion: event.version, fields: ["milkAmount"] })]);
    expect(pending).toEqual(query.questions);
    expect(fixture.legacy.writes).toHaveLength(writes);
    const queriedEvent = query.events.find(current => current.id === event.id)!;
    expect(queriedEvent).toMatchObject({ version: event.version, facts: event.facts, states: event.states, missing: event.missing, complete: event.complete, projection: event.projection, projected });
    const persistedEvent = await fixture.store.transaction(async req => fixture.records.repo.get("care-events", "baby-a", event.id, req));
    expect(persistedEvent).toMatchObject({ version: event.version, facts: event.facts, states: event.states, missing: event.missing, complete: event.complete, projection: event.projection, projected });
    const unchangedObsolete = await fixture.store.transaction(async req => fixture.records.repo.get("care-questions", "baby-a", completeQuestion.id, req));
    expect(unchangedObsolete).toMatchObject({ version: completeQuestion.version, eventVersion: completeQuestion.eventVersion, fields: ["burpSuccess"] });

    await expect(fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "obsolete-optional-answer", questionId: completeQuestion.id,
      questionVersion: completeQuestion.version, eventVersion: completeEvent.version, patch: { facts: { burpSuccess: true } } }))
      .rejects.toMatchObject({ code: "QUESTION_STALE" });
    const answered = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "still-effective-mixed-answer", questionId: mixedQuestion.id,
      questionVersion: mixedQuestion.version, eventVersion: event.version, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "partial-milk", facts: { milkAmount: 100 } }] } });
    expect(answered.status).toBe("saved");
    expect(answered.events[0]?.facts).toMatchObject({ milkAmount: 100, milkItems: [{ id: "partial-milk", milkAmount: 100 }] });
  });

  it("keeps two explicit milk details in one completed source meal", async () => {
    const messageId = "message/message_0.db/Msg_mixed/1";
    const receipt = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "mixed-milk-literals", events: [{
      facts: { type: "BOTTLE", milkItems: [
        { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
        { id: "formula-1", milkSource: "FORMULA", milkAmount: 70 },
      ] }, progress: "ended", sources: [source(messageId, "mixed-milk")],
    }] });
    expect(receipt.status).toBe("saved");
    expect(receipt.events).toHaveLength(1);
    expect(receipt.events[0]?.facts).toMatchObject({ milkAmount: 270, startTime: "2026-10-22T00:00:43.000Z", endTime: "2026-10-22T00:00:43.000Z",
      milkItems: [{ id: "goat-1", milkDescription: "羊奶", milkAmount: 200 }, { id: "formula-1", milkSource: "FORMULA", milkAmount: 70 }] });
    expect(receipt.events[0]?.facts).not.toHaveProperty("milkSource");
    expect(receipt.events[0]?.duplicateCandidates).toEqual([]);
    expect(receipt.events[0]?.sources[0]?.eventKey).toBe("mixed-milk");
    expect(receipt.questions).toEqual([]);
    const legacy = await fixture.legacy.listActivities("baby-a");
    expect(legacy).toHaveLength(1);
    expect(legacy[0]).toMatchObject({ milkAmount: 270 });
    expect(legacy[0]).not.toHaveProperty("milkItems");
  });

  it("keeps same-time same-amount bottles distinct only when both known milk kinds differ", async () => {
    const receipt = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "same-amount-different-milk", events: [
      { facts: { type: "BOTTLE", milkItems: [{ id: "sheep-1", milkDescription: "羊奶", milkAmount: 200 }] }, progress: "ended", sources: [source("different-milk", "sheep")] },
      { facts: { type: "BOTTLE", milkItems: [{ id: "formula-1", milkSource: "FORMULA", milkAmount: 200 }] }, progress: "ended", sources: [source("different-milk", "formula")] },
    ] });
    expect(receipt.status).toBe("saved");
    expect(receipt.events.map(event => event.duplicateCandidates)).toEqual([[], []]);

    const sameKind = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "same-amount-same-milk", events: [
      { facts: { type: "BOTTLE", milkItems: [{ id: "formula-copy", milkSource: "FORMULA", milkAmount: 200 }] }, progress: "ended", sources: [source("same-milk", "formula-copy")] },
    ] });
    expect(sameKind.events[0]?.duplicateCandidates).toContain(receipt.events[1]!.id);

    const unknownKind = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "same-amount-unknown-milk", events: [
      { facts: { type: "BOTTLE", milkItems: [{ id: "unknown-copy", milkAmount: 200, milkSourceState: "unknown" }] }, progress: "ended", sources: [source("unknown-milk", "unknown-copy")] },
    ] });
    expect(unknownKind.events[0]?.duplicateCandidates).toEqual(expect.arrayContaining(receipt.events.map(event => event.id)));
  });

  it("does not reinterpret a historical 270 ml activity or arbitrary notes on read", async () => {
    fixture.legacy.activities.set("legacy-270", {
      id: "legacy-270", babyId: "baby-a", type: "BOTTLE", startTime: at(8), endTime: at(8),
      milkAmount: 270, milkSource: "FORMULA", notes: "奶品原话：羊奶",
    });
    const result = await fixture.records.query(fixture.alice, { babyId: "baby-a", date: day });
    expect(result.activities).toEqual([expect.objectContaining({ id: "legacy-270", milkAmount: 270, notes: "奶品原话：羊奶" })]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.facts).toMatchObject({ milkAmount: 270, milkSource: "FORMULA", notes: "奶品原话：羊奶" });
    expect(result.events[0]?.facts).not.toHaveProperty("milkDescription");
    expect(fixture.legacy.writes).toEqual([]);
  });

  it("normalizes obsolete pending coverage on read while retaining honest unknown metadata", async () => {
    const recorded = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "legacy-optional-pending", events: [
      { facts: { type: "BOTTLE", endTime: at(6), milkItems: [{ id: "known-1", milkSource: "FORMULA", milkAmount: 100 }] } },
      { facts: { type: "ROLL_OVER", startTime: at(7) } },
      { facts: { type: "DIAPER", startTime: at(8) } },
      { facts: { type: "ROLL_OVER", startTime: at(9) }, states: { count: "unknown" } },
      { facts: { type: "BOTTLE", endTime: at(10), milkItems: [{ id: "unknown-1", milkSource: "FORMULA", milkAmountState: "unknown" }] } },
    ] });
    const [bottle, roll, diaper] = recorded.events;
    await fixture.store.transaction(async req => {
      await fixture.records.repo.put("care-events", "baby-a", bottle!.id, { ...bottle!, states: { ...bottle!.states, endTime: "pending", preparedMilkAmount: "pending" }, complete: false }, req);
      await fixture.records.repo.put("care-events", "baby-a", roll!.id, { ...roll!, states: { ...roll!.states, count: "pending" }, complete: false }, req);
      await fixture.records.repo.put("care-events", "baby-a", diaper!.id, { ...diaper!, states: { ...diaper!.states, poopColor: "pending" }, complete: false }, req);
    });

    const writes = fixture.legacy.writes.length;
    const query = await fixture.records.query(fixture.alice, { babyId: "baby-a", date: day });
    expect(query.summary?.coverage).toMatchObject({ pendingFields: 0, incompleteEvents: 1, unknownFields: 2 });
    expect(query.events.find(event => event.id === roll!.id)).toMatchObject({ complete: true, states: expect.objectContaining({ count: "pending" }) });
    expect(query.events.find(event => event.id === recorded.events[3]!.id)).toMatchObject({ complete: true, states: expect.objectContaining({ count: "unknown" }) });
    expect(query.events.find(event => event.id === recorded.events[4]!.id)).toMatchObject({ complete: false, states: expect.objectContaining({ milkAmount: "unknown" }) });
    expect(fixture.legacy.writes).toHaveLength(writes);
    const persisted = await fixture.store.transaction(async req => fixture.records.repo.get("care-events", "baby-a", roll!.id, req));
    expect(persisted).toMatchObject({ complete: false, states: expect.objectContaining({ count: "pending" }) });
  });

  it("allows duration to answer a persisted endTime question", async () => {
    const created = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "duration-question", events: [{
      facts: { type: "SLEEP", startTime: at(10) },
    }] });
    const event = created.events[0]!, question = created.questions[0]!;
    expect(question.fields).toEqual(["endTime"]);
    const answered = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "duration-answer", questionId: question.id,
      questionVersion: question.version, eventVersion: event.version, patch: { facts: { durationMinutes: 30 }, progress: "ended" } });
    expect(answered.status).toBe("saved");
    expect(answered.events[0]?.facts).toMatchObject({ durationMinutes: 30, endTime: "2026-10-22T02:30:00.000Z" });
  });

  it("uses original source sentAt for new events but leaves source-less time pending", async () => {
    const withoutSource = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "no-source-time", events: [{
      facts: { type: "BOTTLE", milkItems: [{ id: "no-source-time", milkSource: "BREAST_MILK", milkAmount: 90 }] },
    }] });
    expect(withoutSource.status).toBe("needs_information");
    expect(withoutSource.events[0]?.facts.startTime).toBeUndefined();
    expect(withoutSource.questions[0]?.fields).toEqual(["startTime"]);

    const anchored = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "source-time", events: [{
      facts: { type: "BOTTLE", milkItems: [{ id: "source-time", milkSource: "FORMULA", milkAmount: 100 }] }, sources: [source("source-time")],
    }] });
    expect(anchored.status).toBe("saved");
    expect(anchored.events[0]?.facts.startTime).toBe("2026-10-22T00:00:43.000Z");
    expect(anchored.events[0]?.facts.endTime).toBe("2026-10-22T00:00:43.000Z");
    expect(anchored.events[0]?.facts.durationMinutes).toBeUndefined();
    expect(anchored.events[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "endTime", kind: "default", detail: "source sentAt used as endTime" }),
      expect.objectContaining({ field: "startTime", kind: "calculated" }),
    ]));
  });

  it("persists approved defaults and unquantified optional fields without obsolete questions", async () => {
    const recorded = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "approved-defaults", events: [
      { facts: { type: "DIAPER" }, sources: [source("default-diaper", "diaper")] },
      { facts: { type: "SPIT_UP" }, sources: [source("default-spit", "spit")] },
      { facts: { type: "ROLL_OVER" }, sources: [source("unquantified-roll", "roll")] },
      { facts: { type: "BOTTLE", milkItems: [{ id: "simple-formula", milkSource: "FORMULA", milkAmount: 120 }] }, sources: [source("simple-formula", "bottle")] },
    ] });
    expect(recorded.status).toBe("saved");
    expect(recorded.questions).toEqual([]);
    expect(recorded.events[0]?.facts).toMatchObject({ hasPee: true, hasPoop: false, peeAmount: "LARGE" });
    expect(recorded.events[0]?.facts.poopColor).toBeUndefined();
    expect(recorded.events[1]?.facts.spitUpType).toBe("NORMAL");
    expect(recorded.events[2]?.facts.count).toBeUndefined();
    expect(recorded.events[3]?.facts).not.toHaveProperty("preparedMilkAmount");
    expect(recorded.events[3]?.facts).not.toHaveProperty("durationMinutes");

    const diaper = recorded.events[0]!;
    const corrected = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "replace-diaper-defaults",
      eventId: diaper.id, expectedVersion: diaper.version, patch: { facts: { hasPee: false, hasPoop: true } } });
    expect(corrected.status).toBe("saved");
    expect(corrected.events[0]?.facts).toMatchObject({ hasPee: false, hasPoop: true });
    expect(corrected.events[0]?.facts.peeAmount).toBeUndefined();
    expect(corrected.events[0]?.evidence).not.toContainEqual(expect.objectContaining({ field: "hasPee", kind: "default" }));
    expect(corrected.events[0]?.evidence).not.toContainEqual(expect.objectContaining({ field: "hasPoop", kind: "default" }));

    const spitUp = recorded.events[1]!;
    const projectile = await fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "replace-spit-default",
      eventId: spitUp.id, expectedVersion: spitUp.version, patch: { facts: { spitUpType: "PROJECTILE" } } });
    expect(projectile.events[0]?.facts.spitUpType).toBe("PROJECTILE");
    expect(projectile.events[0]?.evidence).not.toContainEqual(expect.objectContaining({ field: "spitUpType", kind: "default" }));
  });

  it("anchors a completed duration report at source end and derives its cross-midnight start", async () => {
    const original = { ...source("source-sleep"), sentAt: "2026-10-22T00:20:00+08:00" };
    const recorded = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "source-sleep", events: [{
      facts: { type: "SLEEP", durationMinutes: 60 }, progress: "ended", sources: [original],
    }] });
    expect(recorded.status).toBe("saved");
    expect(recorded.events[0]?.facts).toMatchObject({
      startTime: "2026-10-21T15:20:00.000Z", endTime: "2026-10-21T16:20:00.000Z", durationMinutes: 60,
    });
    expect(recorded.events[0]?.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "endTime", kind: "default" }),
      expect.objectContaining({ field: "startTime", kind: "calculated" }),
    ]));
  });

  it("uses source completion time as the second time without overwriting an explicit start", async () => {
    const recorded = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "explicit-start-source-end", events: [{
      facts: { type: "OUTDOOR", startTime: at(7, 30) }, progress: "ended", sources: [source("explicit-start-source-end")],
    }] });
    expect(recorded.status).toBe("saved");
    expect(recorded.events[0]?.facts).toMatchObject({
      startTime: "2026-10-21T23:30:00.000Z", endTime: "2026-10-22T00:00:43.000Z", durationMinutes: 30 + 43 / 60,
    });
    expect(recorded.events[0]?.evidence).toContainEqual(expect.objectContaining({ field: "endTime", kind: "default" }));
  });

  it("keeps explicit-start duration events open when source progress is omitted or unknown", async () => {
    const recorded = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "explicit-start-source-open", events: [
      { facts: { type: "OUTDOOR", startTime: at(5) }, sources: [source("explicit-start-progress-omitted")] },
      { facts: { type: "SLEEP", startTime: at(6) }, progress: "unknown", sources: [source("explicit-start-progress-unknown")] },
    ] });
    expect(recorded.status).toBe("needs_information");
    for (const event of recorded.events) {
      expect(event.progress).toBe("unknown");
      expect(event.facts.endTime).toBeUndefined();
      expect(event.facts.durationMinutes).toBeUndefined();
      expect(event.evidence).not.toContainEqual(expect.objectContaining({ field: "endTime", kind: "default" }));
      expect(recorded.questions.find(question => question.eventId === event.id)?.fields).toEqual(["endTime"]);
    }
  });

  it("reinterprets the original source anchor when an unclassified candidate becomes a completed duration event", async () => {
    const candidate = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "unclassified-duration-source", events: [{
      facts: { notes: "刚结束" }, sources: [source("unclassified-duration-source")],
    }] });
    const event = candidate.events[0]!, question = candidate.questions[0]!;
    expect(event.facts.startTime).toBe("2026-10-22T00:00:43.000Z");
    const typed = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "classify-duration-source-type",
      questionId: question.id, questionVersion: question.version, eventVersion: event.version,
      patch: { facts: { type: "BREASTFEED" } } });
    const durationQuestion = typed.questions[0]!;
    const classified = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "classify-duration-source",
      questionId: durationQuestion.id, questionVersion: durationQuestion.version, eventVersion: durationQuestion.eventVersion,
      patch: { facts: { durationMinutes: 15 }, progress: "ended" } });
    expect(classified.status).toBe("saved");
    expect(classified.events[0]?.facts).toMatchObject({
      startTime: "2026-10-21T23:45:43.000Z", endTime: "2026-10-22T00:00:43.000Z", durationMinutes: 15,
    });
    expect(classified.events[0]?.evidence).toContainEqual(expect.objectContaining({ field: "endTime", kind: "default", detail: "source sentAt used as endTime" }));
  });

  it("does not shift the original event time when a later source completes it", async () => {
    const original = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "source-follow-up-original", events: [{
      facts: { type: "BOTTLE", milkItems: [{ id: "follow-up-milk", milkSource: "BREAST_MILK" }] }, sources: [source("source-follow-up-original")],
    }] });
    const event = original.events[0]!;
    const later = { ...source("source-follow-up-later"), sentAt: "2026-10-22T09:30:00+08:00" };
    const completed = await fixture.records.update(fixture.collectorA, { babyId: "baby-a", requestId: "source-follow-up-update",
      eventId: event.id, expectedVersion: event.version, patch: { facts: { milkItems: [{ id: "follow-up-milk", milkSource: "BREAST_MILK", milkAmount: 110 }] } }, sources: [later] });
    expect(completed.status).toBe("saved");
    expect(completed.events[0]?.facts.startTime).toBe("2026-10-22T00:00:43.000Z");
    expect(completed.events[0]?.sources).toHaveLength(2);
  });

  it("completes an existing end-only duration event with a duration and derives start", async () => {
    const partial = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "end-only-sleep", events: [{
      facts: { type: "SLEEP", endTime: at(10) }, progress: "ended",
    }] });
    const event = partial.events[0]!, question = partial.questions[0]!;
    expect(question.fields).toEqual(["durationMinutes"]);
    const completed = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "end-only-duration-answer",
      questionId: question.id, questionVersion: question.version, eventVersion: event.version, patch: { facts: { durationMinutes: 45 } } });
    expect(completed.status).toBe("saved");
    expect(completed.events[0]?.facts).toMatchObject({ startTime: "2026-10-22T01:15:00.000Z", endTime: "2026-10-22T02:00:00.000Z", durationMinutes: 45 });
  });

  it("keeps a conflict-only question resolvable through an explicit choice", async () => {
    const created = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "conflict-question", events: [
      { facts: { type: "BOTTLE", startTime: at(11), endTime: at(11, 15), milkItems: [{ id: "conflict-milk", milkSource: "BREAST_MILK", milkAmount: 100 }] } },
      { facts: { type: "BREASTFEED", startTime: at(11, 5), endTime: at(11, 20) } },
    ] });
    const conflictEvent = created.events[1]!, question = created.questions.find(item => item.eventId === conflictEvent.id)!;
    expect(question.fields).toEqual([]);
    expect(question.conflicts.some(issue => issue.code === "TIME_OVERLAP")).toBe(true);
    const answered = await fixture.records.confirmOverlap(fixture.alice, { babyId: "baby-a", requestId: "conflict-confirm", eventId: conflictEvent.id,
      expectedVersion: conflictEvent.version, conflictingEventIds: [created.events[0]!.id], reason: "照护者确认当时确有重叠" });
    expect(answered.events[0]?.id).toBe(conflictEvent.id);
  });
});
