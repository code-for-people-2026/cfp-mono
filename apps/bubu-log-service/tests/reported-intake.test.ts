import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateEvent } from "../src/records/rules";
import { ruleSchema } from "../src/records/schemas";
import type { Facts, SourceRef } from "../src/records/types";
import { recordsFixture, type RecordsFixture } from "./fixtures/records";

const now = Date.parse("2026-10-23T12:00:00.000Z");
const reportedIntake = { value: 80, unit: "g", originalText: "  亲喂吃了80克\n" } as const;
const breastfeed: Facts = {
  type: "BREASTFEED",
  startTime: "2026-10-22T10:00:00+08:00",
  durationMinutes: 20,
  burpSuccess: true,
  breastFirmness: "SOFT",
  milkAmount: 30,
};

const inputWithReport = (value: unknown, facts: Facts = breastfeed) => ({
  facts: { ...facts, reportedIntake: value as Facts["reportedIntake"] },
});

describe("reported intake validation", () => {
  it("preserves the caregiver's exact raw text through the schema and direct rules", () => {
    const input = inputWithReport(reportedIntake);
    expect(ruleSchema.parse(input).facts.reportedIntake).toEqual(reportedIntake);

    const result = evaluateEvent(input, { now });
    expect(result.facts.reportedIntake).toEqual(reportedIntake);
    expect(result.facts.milkAmount).toBe(30);
    expect(result.states.reportedIntake).toBe("known");
    expect(result.missing).not.toContain("reportedIntake");
  });

  it.each([
    { name: "negative amount", value: { ...reportedIntake, value: -1 } },
    { name: "amount above range", value: { ...reportedIntake, value: 100001 } },
    { name: "non-finite amount", value: { ...reportedIntake, value: Number.NaN } },
    { name: "unsupported unit", value: { ...reportedIntake, unit: "ml" } },
    { name: "blank original text", value: { ...reportedIntake, originalText: " \n\t" } },
    { name: "overlong original text", value: { ...reportedIntake, originalText: "亲".repeat(4001) } },
    { name: "extra property", value: { ...reportedIntake, confidence: 1 } },
    { name: "missing properties", value: { unit: "g" } },
    { name: "array", value: [reportedIntake] },
    { name: "empty object", value: {} },
    { name: "empty string", value: "" },
  ] as Array<{ name: string; value: unknown }>)("rejects %s at the schema boundary and in direct rules", ({ value }) => {
    const input = inputWithReport(value);
    expect(ruleSchema.safeParse(input).success).toBe(false);
    expect(evaluateEvent(input, { now }).conflicts).toEqual([
      expect.objectContaining({ code: "INVALID_REPORTED_INTAKE", fields: ["reportedIntake"] }),
    ]);
  });

  it("treats an omitted or explicit null report as absent without inventing a weight", () => {
    for (const value of [undefined, null]) {
      const result = evaluateEvent(inputWithReport(value), { now });
      expect(result.conflicts).toEqual([]);
      expect(result.missing).not.toContain("reportedIntake");
      expect(result.facts.milkAmount).toBe(30);
    }

    const withoutWeight = evaluateEvent(inputWithReport(reportedIntake, { ...breastfeed, milkAmount: undefined }), { now });
    expect(withoutWeight.facts.milkAmount).toBeUndefined();
    expect(withoutWeight.evidence).not.toContainEqual(expect.objectContaining({ field: "milkAmount", kind: "calculated" }));
  });

  it("accepts a genuine zero and clears the report for unknown state or an unrelated type", () => {
    const zero = evaluateEvent(inputWithReport({ ...reportedIntake, value: 0, originalText: "实际吃了0克" }), { now });
    expect(zero.facts.reportedIntake).toMatchObject({ value: 0, unit: "g" });
    expect(zero.facts.milkAmount).toBe(30);
    expect(zero.conflicts).toEqual([]);

    const unknown = evaluateEvent({ ...inputWithReport(reportedIntake), states: { reportedIntake: "unknown" } }, { now });
    expect(unknown.facts.reportedIntake).toBeUndefined();
    expect(unknown.states.reportedIntake).toBe("unknown");
    expect(unknown.missing).not.toContain("reportedIntake");

    const bottle = evaluateEvent(inputWithReport(reportedIntake, { type: "BOTTLE", milkAmount: 80 }), { now });
    expect(bottle.facts.reportedIntake).toBeUndefined();
    expect(bottle.states.reportedIntake).toBe("not_applicable");
    expect(bottle.conflicts).not.toContainEqual(expect.objectContaining({ code: "INVALID_REPORTED_INTAKE" }));
  });
});

describe("reported intake persistence and reconciliation", () => {
  let fixture: RecordsFixture;
  const chatSource: SourceRef = {
    kind: "chat", accountId: "synthetic-family", conversationId: "fixture-chat", messageId: "reported-intake-bottle",
    eventKey: "bottle", sentAt: "2026-10-22T08:00:00+08:00", senderId: "synthetic-caregiver",
  };
  const manualSource: SourceRef = {
    kind: "manual", accountId: "synthetic-caregiver", conversationId: "fixture-chat", messageId: "reported-intake-breastfeed",
    eventKey: "breastfeed", sentAt: "2026-10-22T10:00:00+08:00", senderId: "synthetic-caregiver",
  };

  beforeAll(async () => {
    fixture = await recordsFixture();
  });
  afterAll(async () => {
    await fixture.close();
  });

  it("keeps gram reports and explicit ml independently through revisions, replay and legacy reconciliation", async () => {
    const bottle = await fixture.records.record(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-bottle", events: [{
        facts: {
          type: "BOTTLE", startTime: "2026-10-22T08:00:00+08:00", durationMinutes: 15,
          milkSource: "BREAST_MILK", milkAmount: 80, burpSuccess: true,
        }, sources: [chatSource],
      }],
    });
    expect(bottle.status).toBe("saved");
    expect((await fixture.records.summary(fixture.alice, "baby-a", "2026-10-22"))?.metrics.totalMilkAmount).toBe(80);

    const created = await fixture.records.record(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-create", events: [{
        facts: { ...breastfeed, reportedIntake },
        evidence: [{ field: "reportedIntake", kind: "reported", confirmed: true, detail: "explicit grams" }],
        sources: [manualSource],
      }],
    });
    expect(created.status).toBe("saved");
    let event = created.events[0]!;
    expect(event.facts.reportedIntake).toEqual(reportedIntake);
    expect(event.facts.milkAmount).toBe(30);
    expect(event.evidence).toContainEqual(expect.objectContaining({ field: "reportedIntake", kind: "reported" }));

    await fixture.restart();
    event = (await fixture.records.query(fixture.alice, { babyId: "baby-a", eventId: event.id })).events[0]!;
    expect(event.facts.reportedIntake).toEqual(reportedIntake);
    expect(event.facts.milkAmount).toBe(30);
    let projected = fixture.legacy.activities.get(event.legacyId)!;
    expect(projected).not.toHaveProperty("reportedIntake");
    expect(projected.milkAmount).toBe(30);

    const corrected = await fixture.records.update(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-correct", eventId: event.id, expectedVersion: event.version,
      patch: { facts: { reportedIntake: { value: 75, unit: "g", originalText: "  刚才说错了，亲喂是75克  " } } },
    });
    event = corrected.events[0]!;
    expect(event.facts.reportedIntake).toEqual({ value: 75, unit: "g", originalText: "  刚才说错了，亲喂是75克  " });
    expect(event.facts.milkAmount).toBe(30);

    const revisions = await fixture.records.revisions(fixture.alice, "baby-a", event.id);
    expect(revisions.some(revision => revision.version === 1 && revision.after.facts.reportedIntake?.value === 80)).toBe(true);
    const currentRevision = revisions.find(revision => revision.version === event.version)!;
    const undone = await fixture.records.undo(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-undo", eventId: event.id,
      expectedVersion: event.version, revisionId: currentRevision.id,
    });
    event = undone.events[0]!;
    expect(event.facts.reportedIntake).toEqual(reportedIntake);
    expect(event.facts.milkAmount).toBe(30);
    projected = fixture.legacy.activities.get(event.legacyId)!;
    expect(projected).not.toHaveProperty("reportedIntake");
    expect(projected.milkAmount).toBe(30);

    const retracted = await fixture.records.retract(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-retract", eventId: event.id, expectedVersion: event.version,
    });
    event = retracted.events[0]!;
    expect(event.lifecycle).toBe("retracted");
    const replay = await fixture.records.record(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-replay-retracted", events: [{
        facts: { ...breastfeed, reportedIntake }, sources: [manualSource],
      }],
    });
    expect(replay.events[0]?.id).toBe(event.id);
    expect(replay.events[0]?.lifecycle).toBe("retracted");
    expect(fixture.legacy.activities.has(event.legacyId)).toBe(false);

    const restored = await fixture.records.retract(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-restore", eventId: event.id, expectedVersion: event.version,
    }, true);
    event = restored.events[0]!;
    expect(event.lifecycle).toBe("active");
    expect(event.facts.reportedIntake).toEqual(reportedIntake);
    expect(event.facts.milkAmount).toBe(30);

    projected = fixture.legacy.activities.get(event.legacyId)!;
    fixture.legacy.activities.set(projected.id, { ...projected, milkAmount: 35, updatedAt: "2026-10-23T12:05:00Z" });
    const accepted = await fixture.records.reconcile(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-reconcile-milk", eventId: event.id, expectedVersion: event.version,
    });
    event = accepted.events[0]!;
    expect(event.facts.reportedIntake).toEqual(reportedIntake);
    expect(event.facts.milkAmount).toBe(35);
    expect(event.states.reportedIntake).toBe("known");
    expect(event.evidence.some(item => item.field === "reportedIntake")).toBe(true);

    const current = fixture.legacy.activities.get(event.legacyId)!;
    fixture.legacy.activities.set(current.id, {
      id: current.id, babyId: current.babyId, type: "SLEEP", startTime: current.startTime,
      endTime: "2026-10-22T10:40:00.000Z", updatedAt: "2026-10-23T12:06:00Z",
    });
    const typeChanged = await fixture.records.reconcile(fixture.alice, {
      babyId: "baby-a", requestId: "reported-intake-reconcile-type", eventId: event.id, expectedVersion: event.version,
    });
    event = typeChanged.events[0]!;
    expect(event.facts.reportedIntake).toBeUndefined();
    expect(event.states.reportedIntake).toBe("not_applicable");
    expect(event.evidence.some(item => item.field === "reportedIntake")).toBe(false);

    for (const write of fixture.legacy.writes) if (write.desired) expect(write.desired).not.toHaveProperty("reportedIntake");
    expect((await fixture.records.summary(fixture.alice, "baby-a", "2026-10-22"))?.metrics.totalMilkAmount).toBe(80);
  });
});
