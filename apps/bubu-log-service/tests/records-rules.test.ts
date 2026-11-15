import { describe, expect, it } from "vitest";
import { evaluateEvent, timeConflicts } from "../src/records/rules";
import { ruleSchema } from "../src/records/schemas";
import { activityTypes, type Facts } from "../src/records/types";

const startTime = "2026-10-22T10:00:00+08:00";
const endTime = "2026-10-22T10:15:00+08:00";
const now = Date.parse("2026-10-23T12:00:00+08:00");
const evaluate = (facts: Facts) => evaluateEvent({ facts }, { now });
const formulaItem = (milkAmount?: number | null, id = "formula-1") => ({ id, milkSource: "FORMULA" as const, ...(milkAmount === null ? { milkAmountState: "unknown" as const } : milkAmount === undefined ? {} : { milkAmount }) });
const breastMilkItem = (milkAmount?: number | null, id = "breast-1") => ({ id, milkSource: "BREAST_MILK" as const, ...(milkAmount === null ? { milkAmountState: "unknown" as const } : milkAmount === undefined ? {} : { milkAmount }) });
const explicitNullJson = { facts: { type: "DIAPER", startTime, hasPoop: null, hasPee: true }, states: { poopColor: "unknown" } };
describe("all fifteen activity branches", () => {
  const complete: Record<string, Facts> = {
    BREASTFEED: { endTime, burpSuccess: false, breastFirmness: "ELASTIC" },
    BOTTLE: { endTime, milkItems: [breastMilkItem(0)], burpSuccess: true },
    PUMP: { endTime, milkAmount: 121 }, SLEEP: { endTime },
    DIAPER: { hasPoop: true, hasPee: true, poopColor: "GREEN", peeAmount: "SMALL" },
    HEAD_LIFT: { endTime }, PASSIVE_EXERCISE: { endTime }, GAS_EXERCISE: { endTime },
    BATH: { endTime }, OUTDOOR: { endTime }, EARLY_EDUCATION: { endTime },
    ROLL_OVER: { count: 0 }, PULL_TO_SIT: { count: 24 },
    SUPPLEMENT: { supplementType: "PREBIOTICS" }, SPIT_UP: { spitUpType: "NORMAL" },
  };
  it.each(activityTypes)("preserves %s facts, actual zero and notes without UI bounds", type => {
    const result = evaluate({ type, startTime, notes: "照护者备注", ...complete[type] });
    expect(result.conflicts).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.facts.notes).toBe("照护者备注");
    expect(result.facts.type).toBe(type);
  });
  it("does not invent a feeding branch, milk, count, or supplement type", () => {
    const result = evaluateEvent({ facts: {}, intent: "feeding" }, { now });
    expect(result.facts).toEqual({});
    expect(result.missing).toEqual(["type", "startTime"]);
    expect(evaluate({ type: "BOTTLE", startTime }).missing).toEqual(expect.arrayContaining(["milkSource", "milkAmount"]));
    expect(evaluate({ type: "BOTTLE", startTime }).missing).not.toContain("endTime");
    expect(evaluate({ type: "BOTTLE", startTime }).missing).not.toContain("burpSuccess");
    expect(evaluate({ type: "DIAPER", startTime }).facts).toMatchObject({ hasPee: true, hasPoop: false, peeAmount: "LARGE" });
    expect(evaluate({ type: "SPIT_UP", startTime }).facts.spitUpType).toBe("NORMAL");
    expect(evaluate({ type: "SUPPLEMENT", startTime }).facts).not.toHaveProperty("supplementType");
    expect(evaluate({ type: "ROLL_OVER", startTime }).facts).not.toHaveProperty("count");
  });
  it("accepts a bounded literal milk description without widening the legacy enum", () => {
    const result = evaluate({ type: "BOTTLE", endTime, milkItems: [{ id: "goat-1", milkDescription: "  羊奶  ", milkAmount: 200 }] });
    expect(result).toMatchObject({ complete: true, missing: [], facts: { milkItems: [{ id: "goat-1", milkDescription: "羊奶", milkAmount: 200 }], milkAmount: 200 } });
    expect(result.facts).not.toHaveProperty("milkSource");
    expect(ruleSchema.parse({ facts: { type: "BOTTLE", endTime, milkItems: [{ id: "goat-1", milkDescription: " 羊奶 ", milkAmount: 200 }] } }).facts.milkItems?.[0]?.milkDescription).toBe("羊奶");
    expect(() => ruleSchema.parse({ facts: { type: "BOTTLE", endTime, milkItems: [{ id: "goat-1", milkDescription: " ", milkAmount: 200 }] } })).toThrow();
    expect(() => ruleSchema.parse({ facts: { type: "BOTTLE", endTime, milkItems: [{ id: "goat-1", milkDescription: "x".repeat(101), milkAmount: 200 }] } })).toThrow();
  });
  it("normalizes a complete multi-milk meal idempotently and exposes only a derived total", () => {
    const first = evaluateEvent({ facts: { type: "BOTTLE", endTime, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] }, progress: "ended" }, { now });
    expect(first).toMatchObject({ complete: true, missing: [], facts: { milkAmount: 350, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200, milkSourceState: "known", milkAmountState: "known" },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150, milkSourceState: "known", milkAmountState: "known" },
    ] }, states: { milkAmount: "known", milkSource: "known" } });
    expect(first.facts).not.toHaveProperty("milkSource");
    expect(evaluateEvent(first, { now })).toEqual(first);
  });
  it("does not publish a complete total when one item is pending or explicitly unknown", () => {
    const pending = evaluate({ type: "BOTTLE", endTime, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 }, formulaItem(),
    ] });
    expect(pending.facts.milkAmount).toBeUndefined();
    expect(pending.missing).toEqual(["milkAmount"]);
    expect(pending.facts.milkItems?.[0]).toMatchObject({ milkAmount: 200, milkAmountState: "known" });
    expect(pending.facts.milkItems?.[1]).toMatchObject({ milkAmountState: "pending" });
    const unknown = evaluate({ type: "BOTTLE", endTime, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 }, formulaItem(null),
    ] });
    expect(unknown.facts.milkAmount).toBeUndefined();
    expect(unknown.states.milkAmount).toBe("unknown");
    expect(unknown.missing).not.toContain("milkAmount");
    expect(unknown.complete).toBe(false);
  });
  it("does not invent a stool color and keeps explicit stool with unknown color complete", () => {
    const poop = evaluate({ type: "DIAPER", startTime, hasPoop: true, hasPee: false });
    expect(poop.facts.poopColor).toBeUndefined();
    expect(poop.facts.peeAmount).toBeUndefined();
    expect(poop.states.peeAmount).toBe("not_applicable");
    expect(poop.missing).toEqual([]);
    expect(poop.complete).toBe(true);
    expect(poop.evidence).not.toContainEqual(expect.objectContaining({ field: "poopColor", kind: "default" }));
    expect(evaluateEvent(poop, { now })).toEqual(poop);
    const urine = evaluate({ type: "DIAPER", startTime, hasPoop: false, hasPee: true, peeAmount: "LARGE", poopColor: "RED" });
    expect(urine.complete).toBe(true);
    expect(urine.facts.poopColor).toBeUndefined();
    expect(urine.states.poopColor).toBe("not_applicable");
    expect(urine.missing).not.toContain("poopPhotoUrl");
  });
  it("never defaults an explicit unknown, null, or unconfirmed image observation", () => {
    const unknown = evaluateEvent({ facts: { type: "DIAPER", startTime, hasPoop: true, hasPee: true }, states: { poopColor: "unknown" } }, { now });
    expect(unknown.facts.poopColor).toBeUndefined();
    expect(unknown.states.poopColor).toBe("unknown");
    expect(unknown.facts.peeAmount).toBe("LARGE");
    expect(unknown.complete).toBe(true);
    const explicitNull = evaluateEvent(ruleSchema.parse(explicitNullJson), { now });
    expect(explicitNull.facts.hasPoop).toBeNull();
    expect(explicitNull.facts.poopColor).toBeUndefined();
    expect(explicitNull.missing).toEqual(["hasPoop"]);
    expect(explicitNull.complete).toBe(false);
    const image = evaluateEvent({ facts: { type: "DIAPER", startTime, hasPoop: true, hasPee: true, poopColor: "RED" }, evidence: [{ field: "poopColor", kind: "image", confirmed: false, detail: "可能偏红" }] }, { now });
    expect(image.facts.poopColor).toBeUndefined();
    expect(image.states.poopColor).toBe("pending");
    expect(image.facts.peeAmount).toBe("LARGE");
    expect(image.missing).toEqual([]);
    expect(image.complete).toBe(true);
    const unknownPee = evaluateEvent({ facts: { type: "DIAPER", startTime }, states: { hasPee: "unknown" } }, { now });
    expect(unknownPee.facts.hasPee).toBeUndefined();
    expect(unknownPee.states.hasPee).toBe("unknown");
    expect(unknownPee.facts.peeAmount).toBeUndefined();
    expect(unknownPee.missing).not.toContain("hasPee");
    const uncertainPee = evaluateEvent({ facts: { type: "DIAPER", startTime, hasPee: true }, evidence: [{ field: "hasPee", kind: "image", confirmed: false }] }, { now });
    expect(uncertainPee.facts.hasPee).toBeUndefined();
    expect(uncertainPee.states.hasPee).toBe("pending");
    expect(uncertainPee.evidence).not.toContainEqual(expect.objectContaining({ field: "hasPee", kind: "default" }));
  });
  it("keeps unknown distinct from zero and suppresses repeated questions", () => {
    const unknown = evaluateEvent({ facts: { type: "BOTTLE", startTime, endTime, milkItems: [breastMilkItem(null)], burpSuccess: false } }, { now });
    expect(unknown.facts.milkAmount).toBeUndefined();
    expect(unknown.states.milkAmount).toBe("unknown");
    expect(unknown.missing).not.toContain("milkAmount");
    expect(unknown.complete).toBe(false);
  });
  it("keeps ongoing and missing-ended sleep distinct, and permits an orphan wake-up candidate", () => {
    const ongoing = evaluateEvent({ facts: { type: "SLEEP", startTime }, progress: "ongoing" }, { now });
    expect(ongoing.states.endTime).toBe("not_yet");
    expect(ongoing.missing).toEqual([]);
    expect(ongoing.complete).toBe(true);
    const ended = evaluateEvent({ facts: { type: "SLEEP", startTime }, progress: "ended" }, { now });
    expect(ended.states.endTime).toBe("pending");
    expect(ended.complete).toBe(false);
    expect(evaluate({ type: "SLEEP", endTime }).missing).toEqual(["durationMinutes"]);
  });
  it.each([
    { type: "BREASTFEED", breastFirmness: "SOFT" },
    { type: "PUMP" },
  ] as const)("defers unfinished outcomes for ongoing $type, then asks after ending", branch => {
    const ongoing = evaluateEvent({ facts: { ...branch, startTime }, progress: "ongoing", states: { burpSuccess: "not_yet" } }, { now });
    expect(ongoing.missing).toEqual([]);
    expect(ongoing.complete).toBe(true);
    if (branch.type !== "PUMP") expect(ongoing.states.burpSuccess).toBeUndefined();
    if (branch.type !== "BREASTFEED") expect(ongoing.states.milkAmount).toBe("not_yet");
    expect(ongoing.facts.milkAmount).toBeUndefined();
    const ended = evaluateEvent({ ...ongoing, facts: { ...ongoing.facts, endTime }, states: { ...ongoing.states, endTime: "known" }, progress: "ended" }, { now });
    if (branch.type !== "PUMP") expect(ended.missing).not.toContain("burpSuccess");
    if (branch.type !== "BREASTFEED") expect(ended.missing).toContain("milkAmount");
    expect(ended.complete).toBe(branch.type === "BREASTFEED");
  });
  it("retains explicit current amounts and unknown outcomes while ongoing", () => {
    const ongoing = evaluateEvent({ facts: { type: "BOTTLE", startTime, milkItems: [formulaItem(0)], preparedMilkAmount: 120 }, states: { burpSuccess: "unknown" }, progress: "ongoing" }, { now });
    expect(ongoing.facts.milkAmount).toBe(0);
    expect(ongoing.states.burpSuccess).toBe("unknown");
    expect(ongoing.states.remainingMilkAmount).toBeUndefined();
    expect(ongoing.missing).toEqual([]);
  });
  it("keeps omitted burp optional while milk and time still require actual answers", () => {
    const breastfed = evaluate({ type: "BREASTFEED", startTime, endTime });
    expect(breastfed.facts).not.toHaveProperty("burpSuccess");
    expect(breastfed.facts).not.toHaveProperty("breastFirmness");
    expect(breastfed.missing).toEqual([]);
    expect(breastfed.complete).toBe(true);
    const bottle = evaluate({ type: "BOTTLE", startTime, milkItems: [breastMilkItem()] });
    expect(bottle.missing).toEqual(["milkAmount"]);
    expect(bottle.missing).not.toContain("burpSuccess");
    expect(bottle.complete).toBe(false);
  });
  it("does not turn uncertain image observations into confirmed diaper properties", () => {
    const result = evaluateEvent({ facts: { type: "DIAPER", startTime, hasPoop: true, hasPee: false, poopColor: "RED" }, evidence: [{ field: "poopColor", kind: "image", confirmed: false, detail: "可能偏红" }] }, { now });
    expect(result.facts.poopColor).toBeUndefined();
    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.evidence[0]?.detail).toBe("可能偏红");
  });
  it("retires business-default evidence when an explicit value or image replaces it", () => {
    const initial = evaluate({ type: "DIAPER", startTime });
    expect(initial.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "hasPee", kind: "default" }),
      expect.objectContaining({ field: "hasPoop", kind: "default" }),
      expect.objectContaining({ field: "peeAmount", kind: "default" }),
    ]));
    const explicit = evaluateEvent({ facts: { ...initial.facts, hasPoop: true, peeAmount: "SMALL" }, states: initial.states, evidence: initial.evidence }, { now });
    expect(explicit.facts.hasPoop).toBe(true);
    expect(explicit.facts.peeAmount).toBe("SMALL");
    expect(explicit.evidence).not.toContainEqual(expect.objectContaining({ field: "hasPoop", kind: "default" }));
    expect(explicit.evidence).not.toContainEqual(expect.objectContaining({ field: "peeAmount", kind: "default" }));
    const laterImage = evaluateEvent({ facts: initial.facts, states: initial.states, evidence: [...initial.evidence, { field: "hasPee", kind: "image", confirmed: false }] }, { now });
    expect(laterImage.facts.hasPee).toBeUndefined();
    expect(laterImage.states.hasPee).toBe("pending");
    expect(laterImage.evidence).not.toContainEqual(expect.objectContaining({ field: "hasPee", kind: "default" }));
    const withoutPoop = evaluateEvent({ facts: { type: "DIAPER", startTime, hasPoop: false, hasPee: true }, evidence: [...initial.evidence, { field: "hasPoop", kind: "reported", confirmed: true }] }, { now });
    expect(withoutPoop.states.poopColor).toBe("not_applicable");
    expect(withoutPoop.evidence).not.toContainEqual(expect.objectContaining({ field: "hasPoop", kind: "default" }));
  });
});
describe("formula amounts and temporal consistency", () => {
  const bottle: Facts = { type: "BOTTLE", startTime, endTime, milkItems: [formulaItem()], burpSuccess: false };
  it("requires same-bottle evidence before deriving intake and retains the derivation", () => {
    const unlinked = evaluate({ ...bottle, preparedMilkAmount: 120, remainingMilkAmount: 20 });
    expect(unlinked.facts.milkAmount).toBeUndefined();
    expect(unlinked.missing).toEqual(["milkAmount"]);
    const result = evaluate({ ...bottle, preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true });
    expect(result.facts.milkAmount).toBe(100);
    expect(result.complete).toBe(true);
    expect(result.evidence).toContainEqual(expect.objectContaining({ field: "milkAmount", kind: "calculated", confirmed: true }));
    expect(evaluate({ ...bottle, preparedMilkAmount: 120 }).facts.milkAmount).toBeUndefined();
  });
  it.each([
    [{ preparedMilkAmount: 100, remainingMilkAmount: 120 }, "REMAINDER_EXCEEDS_PREPARED"],
    [{ preparedMilkAmount: 120, remainingMilkAmount: 20, milkItems: [formulaItem(120)], sameBottle: true }, "MILK_AMOUNT_MISMATCH"],
    [{ preparedMilkAmount: 120, milkItems: [formulaItem(140)] }, "CONSUMED_EXCEEDS_PREPARED"],
    [{ milkItems: [{ id: "formula-1", milkSource: "FORMULA" as const, milkAmount: -1 }] }, "INVALID_MILK_ITEM_AMOUNT"],
    [{ milkItems: [{ id: "formula-1", milkSource: "FORMULA" as const, milkAmount: Number.NaN }] }, "INVALID_MILK_ITEM_AMOUNT"],
  ] as const)("retains a clarification conflict for contradictory amount %o", (fields, code) => {
    expect(evaluate({ ...bottle, ...(fields as Facts) }).conflicts.map(item => item.code)).toContain(code);
  });
  it("accepts genuine amounts beyond old sliders and rejects fractional counts", () => {
    expect(evaluate({ ...bottle, preparedMilkAmount: 321.5, milkItems: [formulaItem(301.5)] }).conflicts).toEqual([]);
    expect(evaluate({ type: "ROLL_OVER", startTime, count: 1.5 }).conflicts[0]?.code).toBe("INVALID_NUMBER");
  });
  it("does not compare a whole multi-item meal with optional preparation metadata for one bottle", () => {
    const result = evaluate({ ...bottle, preparedMilkAmount: 200, milkItems: [
      { id: "goat-1", milkDescription: "羊奶", milkAmount: 200 },
      { id: "formula-1", milkSource: "FORMULA", milkAmount: 150 },
    ] });
    expect(result.facts.milkAmount).toBe(350);
    expect(result.conflicts.map(item => item.code)).not.toContain("CONSUMED_EXCEEDS_PREPARED");
  });
  it("normalizes all three equivalent completed-time pairs to the same interval", () => {
    const expected = { startTime: "2026-10-22T02:00:00.000Z", endTime: "2026-10-22T04:00:00.000Z", durationMinutes: 120 };
    for (const facts of [
      { type: "SLEEP" as const, startTime: "2026-10-22T10:00:00+08:00", endTime: "2026-10-22T12:00:00+08:00" },
      { type: "SLEEP" as const, startTime: "2026-10-22T10:00:00+08:00", durationMinutes: 120 },
      { type: "SLEEP" as const, endTime: "2026-10-22T12:00:00+08:00", durationMinutes: 120 },
    ]) {
      const result = evaluate(facts);
      expect(result.facts).toMatchObject(expected);
      expect(result.complete).toBe(true);
      expect(result.missing).toEqual([]);
    }
  });
  it.each(["PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "EARLY_EDUCATION"] as const)("%s is complete without a duration", type => {
    const result = evaluate({ type, startTime });
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.facts.durationMinutes).toBeUndefined();
  });
  it("keeps a single completion timestamp as a stable point alias without inventing a zero duration", () => {
    const first = evaluateEvent({ facts: { type: "BOTTLE", endTime: "2026-11-01T04:00:00Z", milkItems: [formulaItem(180)] } }, { now: Date.parse("2026-11-02T00:00:00Z") });
    expect(first.facts.startTime).toBe("2026-11-01T04:00:00.000Z");
    expect(first.facts.durationMinutes).toBeUndefined();
    expect(first.evidence).toContainEqual(expect.objectContaining({ field: "startTime", detail: "single completion timestamp stored as event time" }));
    const repeated = evaluateEvent(first, { now: Date.parse("2026-11-02T00:00:00Z") });
    expect(repeated.facts.durationMinutes).toBeUndefined();
    expect(evaluateEvent(repeated, { now: Date.parse("2026-11-02T00:00:00Z") })).toEqual(repeated);

    const explicitZero = evaluateEvent({ facts: { type: "BOTTLE", startTime: "2026-11-01T04:00:00Z", endTime: "2026-11-01T04:00:00Z", durationMinutes: 0, milkItems: [formulaItem(180)] } }, { now: Date.parse("2026-11-02T00:00:00Z") });
    expect(explicitZero.facts.durationMinutes).toBe(0);
    const corrected = evaluateEvent({ ...first, facts: { ...first.facts, endTime: "2026-11-01T04:05:00Z", durationMinutes: 5 }, evidence: first.evidence.filter(item => item.field !== "startTime") }, { now: Date.parse("2026-11-02T00:00:00Z") });
    expect(corrected.facts.durationMinutes).toBe(5);
  });
  it("keeps optional counts unquantified and defaults only ordinary spit-up", () => {
    for (const type of ["ROLL_OVER", "PULL_TO_SIT"] as const) {
      const result = evaluate({ type, startTime });
      expect(result.complete).toBe(true);
      expect(result.facts.count).toBeUndefined();
      expect(result.states.count).toBeUndefined();
    }
    const spitUp = evaluate({ type: "SPIT_UP", startTime });
    expect(spitUp).toMatchObject({ complete: true, facts: { spitUpType: "NORMAL" } });
    expect(spitUp.evidence).toContainEqual(expect.objectContaining({ field: "spitUpType", kind: "default" }));
    const unknown = evaluateEvent({ facts: { type: "SPIT_UP", startTime }, states: { spitUpType: "unknown" } }, { now });
    expect(unknown.facts.spitUpType).toBeUndefined();
    expect(unknown.complete).toBe(true);
  });
  it("computes cross-midnight durations without creating two events", () => {
    const sleep = evaluate({ type: "SLEEP", startTime: "2026-10-21T23:30:00+08:00", endTime: "2026-10-22T01:00:00+08:00" });
    expect(sleep.facts.durationMinutes).toBe(90);
    expect(sleep.complete).toBe(true);
    expect(evaluate({ type: "SLEEP", startTime, durationMinutes: 25 }).facts.endTime).toBe("2026-10-22T02:25:00.000Z");
  });
  it("rejects inconsistent or future times without substituting the collection time", () => {
    expect(evaluate({ type: "SLEEP", startTime, endTime, durationMinutes: 20 }).conflicts[0]?.code).toBe("DURATION_MISMATCH");
    expect(evaluate({ type: "SLEEP", startTime: endTime, endTime: startTime }).conflicts[0]?.code).toBe("END_BEFORE_START");
    expect(evaluate({ type: "SLEEP", startTime: "2026-10-23T13:00:00+08:00" }).conflicts[0]?.code).toBe("FUTURE_TIME");
    expect(evaluate({ type: "SLEEP", startTime: "2026-10-22 10:00" }).conflicts[0]?.code).toBe("INVALID_TIME");
    expect(evaluate({ type: "SLEEP", startTime: "2026-02-30T10:00:00+08:00" }).conflicts[0]?.code).toBe("INVALID_TIME");
  });
  it("reuses new evidence to calculate a previously unknown amount without duplicating evidence", () => {
    const input = { facts: { ...bottle, milkItems: [formulaItem()], preparedMilkAmount: 120, remainingMilkAmount: 120, sameBottle: true } };
    const first = evaluateEvent(input, { now });
    expect(first.facts.milkAmount).toBe(0);
    expect(first.states.milkAmount).toBe("known");
    expect(evaluateEvent(first, { now }).evidence).toEqual(first.evidence);
    const unknownDuration = evaluateEvent({ facts: { type: "SLEEP", startTime }, states: { durationMinutes: "unknown" } }, { now });
    expect(unknownDuration.missing).not.toContain("endTime");
    expect(unknownDuration.complete).toBe(false);
  });
  it("allows outdoor during sleep and asks about conflicting sleep/exercise intervals", () => {
    const sleep: Facts = { type: "SLEEP", startTime, endTime };
    expect(timeConflicts(sleep, { type: "OUTDOOR", startTime, endTime })).toEqual([]);
    expect(timeConflicts(sleep, { type: "HEAD_LIFT", startTime, endTime })[0]?.code).toBe("TIME_OVERLAP");
    expect(timeConflicts({ ...bottle, type: "BOTTLE" }, { type: "BREASTFEED", startTime, endTime })).toHaveLength(1);
  });
});
