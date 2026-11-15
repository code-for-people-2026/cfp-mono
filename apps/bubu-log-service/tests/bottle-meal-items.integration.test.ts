import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CareEvent, PendingQuestion } from "../src/records/types";
import { recordsFixture, source, type RecordsFixture } from "./fixtures/records";

const time = (hour: number) => `2026-10-22T${String(hour).padStart(2, "0")}:00:00+08:00`;
const exactMeal = () => ({ facts: { type: "BOTTLE" as const, startTime: time(20), milkItems: [
  { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
  { id: "formula-1", milkSource: "FORMULA" as const, milkAmount: 150 },
] }, progress: "ended" as const });

describe("bottle meal milk items", () => {
  let fixture: RecordsFixture;
  beforeAll(async () => { fixture = await recordsFixture(); }, 30_000);
  beforeEach(async () => { await fixture.resetRecords(); });
  afterAll(async () => { await fixture?.close(); });

  it("stores the exact two-detail meal once and projects one aggregate row", async () => {
    const receipt = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "exact-two-item-meal", events: [exactMeal()] });
    expect(receipt.status).toBe("saved");
    expect(receipt.questions).toEqual([]);
    expect(receipt.events).toHaveLength(1);
    expect(receipt.events[0]).toMatchObject({ complete: true, facts: { milkAmount: 350, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] } });
    const query = await fixture.records.query(fixture.alice, { babyId: "baby-a", date: "2026-10-22" });
    expect(query.activities).toHaveLength(1);
    expect(query.activities[0]).toMatchObject({ type: "BOTTLE", milkAmount: 350, milkItems: receipt.events[0]!.facts.milkItems });
    expect(query.activities[0]).not.toHaveProperty("milkDescription");
    expect(query.summary?.metrics).toMatchObject({ bottleCount: 1, totalMilkAmount: 350 });
    expect(fixture.legacy.writes.at(-1)?.desired).not.toHaveProperty("milkItems");
    expect(fixture.legacy.writes.at(-1)?.desired?.notes).toBeUndefined();
  });

  it("answers only the pending detail, preserves its sibling and is idempotent", async () => {
    const original = await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "partial-two-item-meal", events: [{
      facts: { type: "BOTTLE", milkItems: [
        { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
        { id: "formula-1", milkSource: "FORMULA" },
      ] }, sources: [source("meal-partial")], progress: "ended",
    }] });
    const event = original.events[0]!, question = original.questions[0]!;
    expect(event.facts.startTime).toBe("2026-10-22T00:00:43.000Z");
    expect(question.fields).toEqual(["milkAmount"]);
    expect(event.facts).not.toHaveProperty("milkAmount");
    const partialSummary = await fixture.records.summary(fixture.alice, "baby-a", "2026-10-22");
    expect(partialSummary?.metrics).toMatchObject({ bottleCount: 1, totalMilkAmount: 200 });
    expect(fixture.legacy.dailyStats.get("baby-a:2026-10-22")).toMatchObject({ bottleCount: 1, totalMilkAmount: 200 });
    const input = { babyId: "baby-a", requestId: "partial-two-item-answer", questionId: question.id,
      questionVersion: question.version, eventVersion: event.version, patch: { facts: {}, milkItemAnswers: [
        { milkItemId: "formula-1", facts: { milkAmount: 150 } },
      ] } };
    const answered = await fixture.records.answer(fixture.collectorA, input);
    expect(answered.status).toBe("saved");
    expect(answered.events[0]).toMatchObject({ id: event.id, version: 2, facts: { milkAmount: 350, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] } });
    expect((await fixture.records.answer(fixture.collectorA, input)).events[0]?.version).toBe(2);
    expect(await fixture.records.revisions(fixture.alice, "baby-a", event.id)).toHaveLength(2);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
    const completedSummary = await fixture.records.summary(fixture.alice, "baby-a", "2026-10-22");
    expect(completedSummary?.metrics).toMatchObject({ bottleCount: 1, totalMilkAmount: 350 });
    expect(fixture.legacy.dailyStats.get("baby-a:2026-10-22")).toMatchObject({ bottleCount: 1, totalMilkAmount: 350 });
  });

  it("normalizes explicit unknown milk-source text without promoting a fake description", async () => {
    const seeded = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "unknown-source-seed", events: [8, 10].map((hour, index) => ({
      facts: { type: "BOTTLE" as const, startTime: time(hour), milkItems: [{ id: index ? "literal-source" : "unknown-source", milkAmount: 90 }] }, progress: "ended" as const,
    })) });
    const unknownEvent = seeded.events[0]!, literalEvent = seeded.events[1]!;
    const unknownQuestion = seeded.questions.find(item => item.eventId === unknownEvent.id)!;
    const literalQuestion = seeded.questions.find(item => item.eventId === literalEvent.id)!;
    const unknown = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "unknown-source-answer", questionId: unknownQuestion.id,
      questionVersion: unknownQuestion.version, eventVersion: unknownQuestion.eventVersion,
      patch: { facts: {}, milkItemAnswers: [{ milkItemId: "unknown-source", facts: { milkDescription: "不知道" } }] } });
    expect(unknown.questions).toEqual([]);
    expect(unknown.events[0]?.facts.milkItems?.[0]).toMatchObject({ id: "unknown-source", milkAmount: 90, milkSourceState: "unknown" });
    expect(unknown.events[0]?.facts.milkItems?.[0]).not.toHaveProperty("milkDescription");
    const literal = await fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "literal-source-answer", questionId: literalQuestion.id,
      questionVersion: literalQuestion.version, eventVersion: literalQuestion.eventVersion,
      patch: { facts: {}, milkItemAnswers: [{ milkItemId: "literal-source", facts: { milkDescription: "羊奶" } }] } });
    expect(literal.status).toBe("saved");
    expect(literal.events[0]?.facts.milkItems?.[0]).toMatchObject({ id: "literal-source", milkAmount: 90, milkDescription: "羊奶", milkSourceState: "known" });
  });

  it("rejects cross-item and array tampering without partially applying a mixed batch", async () => {
    const make = (id: string, hour: number) => ({ facts: { type: "BOTTLE" as const, startTime: time(hour), milkItems: [
      { id: `${id}-known`, milkDescription: "羊奶", milkAmount: 200 },
      { id: `${id}-pending`, milkSource: "FORMULA" as const },
    ] } });
    const receipt = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "tamper-seed-meals", events: [make("a", 8), make("b", 10)] });
    const [first, second] = receipt.events;
    const firstQuestion = receipt.questions.find(question => question.eventId === first!.id)!;
    const secondQuestion = receipt.questions.find(question => question.eventId === second!.id)!;
    await expect(fixture.records.answerBatch(fixture.alice, { babyId: "baby-a", requestId: "tamper-mixed-batch", items: [
      { kind: "answer", eventId: first!.id, questionId: firstQuestion!.id, questionVersion: firstQuestion!.version, eventVersion: first!.version,
        patch: { facts: {}, milkItemAnswers: [{ milkItemId: "a-pending", facts: { milkAmount: 150 } }] } },
      { kind: "answer", eventId: second!.id, questionId: secondQuestion!.id, questionVersion: secondQuestion!.version, eventVersion: second!.version,
        patch: { facts: {}, milkItemAnswers: [{ milkItemId: "b-known", facts: { milkAmount: 999 } }] } },
    ] })).rejects.toMatchObject({ code: "BATCH_MILK_ITEM_TAMPER" });
    const unchanged = await fixture.records.query(fixture.alice, { babyId: "baby-a" });
    expect(unchanged.events.map(event => event.version)).toEqual([1, 1]);
    expect(unchanged.events[0]?.facts.milkItems?.[1]?.milkAmountState).toBe("pending");
    await expect(fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "tamper-replace-array", questionId: firstQuestion!.id,
      questionVersion: firstQuestion!.version, eventVersion: first!.version, patch: { facts: { milkItems: [{ id: "a-pending", milkSource: "FORMULA", milkAmount: 150 }] } } })).rejects.toMatchObject({ code: "BATCH_MILK_ITEM_TAMPER" });
    await expect(fixture.records.answer(fixture.alice, { babyId: "baby-a", requestId: "tamper-cross-item", questionId: firstQuestion!.id,
      questionVersion: firstQuestion!.version, eventVersion: first!.version, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "b-pending", facts: { milkAmount: 150 } }] } })).rejects.toMatchObject({ code: "MILK_ITEM_NOT_FOUND" });
  });

  it("rejects root state attempts to erase authoritative items without a revision or legacy write", async () => {
    const saved = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "state-tamper-seed", events: [exactMeal()] })).events[0]!;
    const revisionCount = (await fixture.records.revisions(fixture.alice, "baby-a", saved.id)).length;
    const writeCount = fixture.legacy.writes.length;
    await expect(fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "state-tamper-items", eventId: saved.id, expectedVersion: saved.version,
      patch: { facts: {}, states: { milkItems: "unknown" } } })).rejects.toMatchObject({ code: "MILK_ITEM_STATE_TAMPER" });
    await expect(fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "state-tamper-total", eventId: saved.id, expectedVersion: saved.version,
      patch: { facts: {}, states: { milkAmount: "unknown" } } })).rejects.toMatchObject({ code: "MILK_ITEM_STATE_TAMPER" });
    const current = (await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: saved.id })).events[0]!;
    expect(current).toMatchObject({ version: saved.version, facts: { milkAmount: 350, milkItems: saved.facts.milkItems } });
    expect(await fixture.records.revisions(fixture.alice, "baby-a", saved.id)).toHaveLength(revisionCount);
    expect(fixture.legacy.writes).toHaveLength(writeCount);
  });

  it("rejects editable root milk facts for new bottle meals while preserving pump amounts", async () => {
    const saved = (await fixture.records.record(fixture.alice, {
      babyId: "baby-a", requestId: "derived-root-seed", events: [exactMeal()],
    })).events[0]!;
    const revisionCount = (await fixture.records.revisions(fixture.alice, "baby-a", saved.id)).length;
    const writeCount = fixture.legacy.writes.length;
    const attempts: Array<{ requestId: string; facts: { milkAmount: number } | { milkSource: "FORMULA" } | { milkDescription: string } }> = [
      { requestId: "derived-root-amount", facts: { milkAmount: 999 } },
      { requestId: "derived-root-source", facts: { milkSource: "FORMULA" } },
      { requestId: "derived-root-description", facts: { milkDescription: "羊奶" } },
    ];
    for (const attempt of attempts) {
      await expect(fixture.records.update(fixture.alice, {
        babyId: "baby-a", requestId: attempt.requestId, eventId: saved.id, expectedVersion: saved.version,
        patch: { facts: attempt.facts },
      })).rejects.toMatchObject({ code: "BOTTLE_DERIVED_ROOT_INPUT" });
    }
    const unchanged = (await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: saved.id })).events[0]!;
    expect(unchanged).toMatchObject({ version: saved.version, facts: { milkAmount: 350, milkItems: saved.facts.milkItems } });
    expect(await fixture.records.revisions(fixture.alice, "baby-a", saved.id)).toHaveLength(revisionCount);
    expect(fixture.legacy.writes).toHaveLength(writeCount);

    const pump = (await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "pump-root-seed", events: [{
      facts: { type: "PUMP", startTime: time(22), milkAmount: 100 }, progress: "ended",
    }] })).events[0]!;
    const corrected = await fixture.records.update(fixture.alice, {
      babyId: "baby-a", requestId: "pump-root-correction", eventId: pump.id, expectedVersion: pump.version,
      patch: { facts: { milkAmount: 120 } },
    });
    expect(corrected.events[0]?.facts.milkAmount).toBe(120);
  });

  it("appends a same-meal top-up with stable identities, keeps explicit meals distinct, and does not enrich drifted core rows", async () => {
    const first = (await fixture.records.record(fixture.collectorA, { babyId: "baby-a", requestId: "same-meal-first", events: [{
      facts: { type: "BOTTLE", milkItems: [{ id: "formula-1", milkSource: "FORMULA", milkAmount: 100 }] },
      sources: [source("same-meal-first")],
    }] })).events[0]!;
    const topped = await fixture.records.update(fixture.collectorA, { babyId: "baby-a", requestId: "same-meal-top-up", eventId: first.id, expectedVersion: first.version,
      patch: { facts: { milkItems: [
        { id: "formula-1", milkSource: "FORMULA", milkAmount: 100 },
        { id: "formula-2", milkSource: "FORMULA", milkAmount: 50 },
      ] } }, sources: [source("same-meal-top-up")] });
    expect(topped.events[0]).toMatchObject({ id: first.id, facts: { milkAmount: 150, milkItems: [{ id: "formula-1" }, { id: "formula-2" }] } });
    expect(topped.events[0]?.sources.map(item => item.messageId)).toEqual(["same-meal-first", "same-meal-top-up"]);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(1);
    await expect(fixture.records.update(fixture.alice, { babyId: "baby-a", requestId: "same-meal-reorder", eventId: first.id, expectedVersion: topped.events[0]!.version,
      patch: { facts: { milkItems: [
        { id: "formula-2", milkSource: "FORMULA", milkAmount: 50 },
        { id: "formula-1", milkSource: "FORMULA", milkAmount: 100 },
      ] } } })).rejects.toMatchObject({ code: "MILK_ITEM_IDENTITY_CHANGED" });

    const separate = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "explicit-different-meals", events: [
      { facts: { type: "BOTTLE", startTime: time(12), milkItems: [{ id: "meal-a", milkDescription: "羊奶", milkAmount: 200 }, { id: "meal-a-formula", milkSource: "FORMULA", milkAmount: 150 }] } },
      { facts: { type: "BOTTLE", startTime: time(14), milkItems: [{ id: "meal-b", milkSource: "FORMULA", milkAmount: 350 }] } },
    ] });
    expect(separate.events).toHaveLength(2);
    expect(separate.events.every(event => !event.duplicateCandidates.length)).toBe(true);
    expect(await fixture.legacy.listActivities("baby-a")).toHaveLength(3);

    const row = fixture.legacy.activities.get(separate.events[0]!.legacyId)!;
    fixture.legacy.activities.set(row.id, { ...row, milkAmount: 360, updatedAt: "2026-10-23T12:30:00.000Z" });
    const drifted = await fixture.records.query(fixture.alice, { babyId: "baby-a", date: "2026-10-22" });
    const observed = drifted.activities.find(activity => activity.id === row.id)!;
    expect(observed.milkAmount).toBe(360);
    expect(observed).not.toHaveProperty("milkItems");
    expect(drifted.summary?.metrics.totalMilkAmount).toBe(860);
    await expect(fixture.records.reconcile(fixture.alice, { babyId: "baby-a", requestId: "ambiguous-multi-item-drift", eventId: separate.events[0]!.id,
      expectedVersion: separate.events[0]!.version })).rejects.toMatchObject({ code: "BOTTLE_ITEMS_RECONCILE_AMBIGUOUS" });
    expect(fixture.legacy.activities.get(row.id)?.milkAmount).toBe(360);
  });

  it("projects a legacy milk source only when every detail has the same known standard source", async () => {
    const mixedKnowledge = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "projection-source-mixed-knowledge", events: [{ facts: {
      type: "BOTTLE", startTime: time(7), milkItems: [
        { id: "formula-known", milkSource: "FORMULA", milkAmount: 150 },
        { id: "source-pending", milkAmount: 200 },
      ],
    } }] });
    expect(mixedKnowledge.events[0]?.facts.milkItems?.[1]?.milkSourceState).toBe("pending");
    expect(fixture.legacy.writes.at(-1)?.desired).not.toHaveProperty("milkSource");

    const homogeneous = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "projection-source-homogeneous", events: [{ facts: {
      type: "BOTTLE", startTime: time(9), milkItems: [
        { id: "formula-a", milkSource: "FORMULA", milkAmount: 100 },
        { id: "formula-b", milkSource: "FORMULA", milkAmount: 50 },
      ],
    } }] });
    expect(homogeneous.events[0]?.complete).toBe(true);
    expect(fixture.legacy.writes.at(-1)?.desired).toMatchObject({ milkSource: "FORMULA", milkAmount: 150 });
  });

  it("hides unsupported historical scalar bottle forms while a new item form completes normally", async () => {
    const historicalSeed = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "historical-scalar-seed", events: [{
      intent: "feeding", facts: { milkAmount: 200, milkSource: "FORMULA" }, states: { startTime: "pending" },
    }] });
    const historical = structuredClone(historicalSeed.events[0]!) as CareEvent;
    historical.facts = { type: "BOTTLE", milkAmount: 200, milkSource: "FORMULA" };
    historical.states = { type: "known", startTime: "pending", milkAmount: "known", milkSource: "known" };
    historical.missing = ["startTime"];
    historical.complete = false;
    const historicalQuestion: PendingQuestion = {
      id: `question:${historical.id}`, babyId: "baby-a", eventId: historical.id, version: 1, eventVersion: historical.version,
      fields: ["startTime"], conflicts: [], duplicateCandidates: [], state: "open", updatedAt: historical.updatedAt,
    };
    await fixture.store.transaction(async request => {
      await fixture.records.repo.put("care-events", "baby-a", historical.id, historical, request);
      await fixture.records.repo.put("care-questions", "baby-a", historicalQuestion.id, historicalQuestion, request);
    });

    const current = await fixture.records.record(fixture.alice, { babyId: "baby-a", requestId: "current-item-pending-seed", events: [{ facts: {
      type: "BOTTLE", startTime: time(8), milkItems: [
        { id: "known-goat", milkDescription: "羊奶", milkAmount: 200 },
        { id: "pending-formula", milkSource: "FORMULA" },
      ],
    } }] });
    const visible = await fixture.records.pending(fixture.alice, "baby-a");
    expect(visible.map(question => question.eventId)).toEqual([current.events[0]!.id]);
    expect(visible[0]?.fields).toEqual(["milkAmount"]);

    const completed = await fixture.records.answerBatch(fixture.alice, { babyId: "baby-a", requestId: "current-item-pending-batch", items: [{
      kind: "answer", eventId: current.events[0]!.id, questionId: visible[0]!.id, questionVersion: visible[0]!.version,
      eventVersion: visible[0]!.eventVersion, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "pending-formula", facts: { milkAmount: 150 } }] },
    }] });
    expect(completed.events[0]).toMatchObject({ facts: { milkAmount: 350 } });
    const historicalRevisionCount = (await fixture.records.revisions(fixture.alice, "baby-a", historical.id)).length;
    const historicalWriteCount = fixture.legacy.writes.length;
    for (const [requestId, facts] of [
      ["historical-scalar-notes", { notes: "不得触发旧记录重算" }],
      ["historical-scalar-time", { startTime: time(6) }],
    ] as const) {
      await expect(fixture.records.update(fixture.alice, {
        babyId: "baby-a", requestId, eventId: historical.id, expectedVersion: historical.version, patch: { facts },
      })).rejects.toMatchObject({ code: "LEGACY_BOTTLE_ITEMS_UNAVAILABLE" });
    }
    await expect(fixture.records.reconcile(fixture.alice, {
      babyId: "baby-a", requestId: "historical-scalar-reconcile", eventId: historical.id, expectedVersion: historical.version,
    })).rejects.toMatchObject({ code: "LEGACY_BOTTLE_ITEMS_UNAVAILABLE" });
    const historicalAfter = (await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: historical.id, includeRetracted: true })).events[0]!;
    expect(historicalAfter).toMatchObject({ version: historical.version, projection: historical.projection,
      facts: { type: "BOTTLE", milkAmount: 200, milkSource: "FORMULA" } });
    expect(historicalAfter.facts).not.toHaveProperty("startTime");
    expect(historicalAfter.facts).not.toHaveProperty("milkItems");
    expect(await fixture.records.revisions(fixture.alice, "baby-a", historical.id)).toHaveLength(historicalRevisionCount);
    expect(fixture.legacy.writes).toHaveLength(historicalWriteCount);
    expect(await fixture.records.pending(fixture.alice, "baby-a")).toEqual([]);

    const retracted = (await fixture.records.retract(fixture.alice, {
      babyId: "baby-a", requestId: "historical-scalar-retract", eventId: historical.id, expectedVersion: historical.version,
    })).events[0]!;
    const retractedRevisions = await fixture.records.revisions(fixture.alice, "baby-a", historical.id);
    const retractRevision = retractedRevisions.find(revision => revision.version === retracted.version)!;
    const retractedWriteCount = fixture.legacy.writes.length;
    await expect(fixture.records.retract(fixture.alice, {
      babyId: "baby-a", requestId: "historical-scalar-restore", eventId: historical.id, expectedVersion: retracted.version,
    }, true)).rejects.toMatchObject({ code: "LEGACY_BOTTLE_ITEMS_UNAVAILABLE" });
    await expect(fixture.records.undo(fixture.alice, {
      babyId: "baby-a", requestId: "historical-scalar-undo", eventId: historical.id, expectedVersion: retracted.version,
      revisionId: retractRevision.id,
    })).rejects.toMatchObject({ code: "LEGACY_BOTTLE_ITEMS_UNAVAILABLE" });
    const stillRetracted = (await fixture.records.query(fixture.alice, {
      babyId: "baby-a", eventId: historical.id, includeRetracted: true,
    })).events[0]!;
    expect(stillRetracted).toMatchObject({ lifecycle: "retracted", version: retracted.version,
      facts: { type: "BOTTLE", milkAmount: 200, milkSource: "FORMULA" } });
    expect(await fixture.records.revisions(fixture.alice, "baby-a", historical.id)).toHaveLength(retractedRevisions.length);
    expect(fixture.legacy.writes).toHaveLength(retractedWriteCount);
  });
});
