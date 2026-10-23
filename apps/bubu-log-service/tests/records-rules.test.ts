import { describe, expect, it } from "vitest";
import { evaluateEvent, timeConflicts } from "../src/records/rules";
import { activityTypes, type Facts } from "../src/records/types";

const startTime = "2026-10-22T10:00:00+08:00";
const endTime = "2026-10-22T10:15:00+08:00";
const now = Date.parse("2026-10-23T12:00:00+08:00");
const evaluate = (facts: Facts) => evaluateEvent({ facts }, { now });
describe("all fifteen activity branches", () => {
  const complete: Record<string, Facts> = {
    BREASTFEED: { endTime, burpSuccess: false, breastFirmness: "ELASTIC" },
    BOTTLE: { endTime, milkAmount: 0, milkSource: "BREAST_MILK", burpSuccess: true },
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
  it("never invents the old default values or a feeding branch", () => {
    const result = evaluateEvent({ facts: {}, intent: "feeding" }, { now });
    expect(result.facts).toEqual({});
    expect(result.missing).toEqual(["type", "startTime"]);
    expect(evaluate({ type: "BOTTLE", startTime }).missing).toEqual(expect.arrayContaining(["endTime", "milkSource", "milkAmount", "burpSuccess"]));
    expect(evaluate({ type: "DIAPER", startTime }).facts).not.toHaveProperty("hasPee");
    expect(evaluate({ type: "SPIT_UP", startTime }).facts).not.toHaveProperty("spitUpType");
    expect(evaluate({ type: "SUPPLEMENT", startTime }).facts).not.toHaveProperty("supplementType");
    expect(evaluate({ type: "ROLL_OVER", startTime }).facts).not.toHaveProperty("count");
  });
  it("asks only applicable diaper fields and never requires a photo", () => {
    expect(evaluate({ type: "DIAPER", startTime, hasPoop: true, hasPee: false }).missing).toEqual(["poopColor"]);
    const urine = evaluate({ type: "DIAPER", startTime, hasPoop: false, hasPee: true, peeAmount: "LARGE", poopColor: "RED" });
    expect(urine.complete).toBe(true);
    expect(urine.facts.poopColor).toBeUndefined();
    expect(urine.states.poopColor).toBe("not_applicable");
    expect(urine.missing).not.toContain("poopPhotoUrl");
  });
  it("keeps unknown distinct from zero and suppresses repeated questions", () => {
    const unknown = evaluateEvent({ facts: { type: "BOTTLE", startTime, endTime, milkSource: "BREAST_MILK", milkAmount: 90, burpSuccess: false }, states: { milkAmount: "unknown" } }, { now });
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
    expect(evaluate({ type: "SLEEP", endTime }).missing).toEqual(["startTime"]);
  });
  it.each([
    { type: "BREASTFEED", breastFirmness: "SOFT" },
    { type: "BOTTLE", milkSource: "BREAST_MILK" },
    { type: "BOTTLE", milkSource: "FORMULA", preparedMilkAmount: 120 },
    { type: "PUMP" },
  ] as const)("defers unfinished outcomes for ongoing $type, then asks after ending", branch => {
    const ongoing = evaluateEvent({ facts: { ...branch, startTime }, progress: "ongoing", states: { burpSuccess: "not_yet" } }, { now });
    expect(ongoing.missing).toEqual([]);
    expect(ongoing.complete).toBe(true);
    if (branch.type !== "PUMP") expect(ongoing.states.burpSuccess).toBe("not_yet");
    if (branch.type !== "BREASTFEED") expect(ongoing.states.milkAmount).toBe("not_yet");
    expect(ongoing.facts.milkAmount).toBeUndefined();
    const ended = evaluateEvent({ ...ongoing, facts: { ...ongoing.facts, endTime }, states: { ...ongoing.states, endTime: "known" }, progress: "ended" }, { now });
    if (branch.type !== "PUMP") expect(ended.missing).toContain("burpSuccess");
    if (branch.type !== "BREASTFEED") expect(ended.missing).toContain("milkAmount");
    expect(ended.complete).toBe(false);
  });
  it("retains explicit current amounts and unknown outcomes while ongoing", () => {
    const ongoing = evaluateEvent({ facts: { type: "BOTTLE", startTime, milkSource: "FORMULA", preparedMilkAmount: 120, milkAmount: 0 }, states: { burpSuccess: "unknown" }, progress: "ongoing" }, { now });
    expect(ongoing.facts.milkAmount).toBe(0);
    expect(ongoing.states.burpSuccess).toBe("unknown");
    expect(ongoing.states.remainingMilkAmount).toBe("not_yet");
    expect(ongoing.missing).toEqual([]);
  });
  it("does not turn uncertain image observations into confirmed diaper properties", () => {
    const result = evaluateEvent({ facts: { type: "DIAPER", startTime, hasPoop: true, hasPee: false, poopColor: "RED" }, evidence: [{ field: "poopColor", kind: "image", confirmed: false, detail: "可能偏红" }] }, { now });
    expect(result.facts.poopColor).toBeUndefined();
    expect(result.missing).toEqual(["poopColor"]);
    expect(result.evidence[0]?.detail).toBe("可能偏红");
  });
});
describe("formula amounts and temporal consistency", () => {
  const bottle: Facts = { type: "BOTTLE", startTime, endTime, milkSource: "FORMULA", burpSuccess: false };
  it("requires same-bottle evidence before deriving intake and retains the derivation", () => {
    const unlinked = evaluate({ ...bottle, preparedMilkAmount: 120, remainingMilkAmount: 20 });
    expect(unlinked.facts.milkAmount).toBeUndefined();
    expect(unlinked.missing).toContain("sameBottle");
    const result = evaluate({ ...bottle, preparedMilkAmount: 120, remainingMilkAmount: 20, sameBottle: true });
    expect(result.facts.milkAmount).toBe(100);
    expect(result.complete).toBe(true);
    expect(result.evidence).toContainEqual(expect.objectContaining({ field: "milkAmount", kind: "calculated", confirmed: true }));
    expect(evaluate({ ...bottle, preparedMilkAmount: 120 }).facts.milkAmount).toBeUndefined();
  });
  it.each([
    [{ preparedMilkAmount: 100, remainingMilkAmount: 120 }, "REMAINDER_EXCEEDS_PREPARED"],
    [{ preparedMilkAmount: 120, remainingMilkAmount: 20, milkAmount: 120, sameBottle: true }, "MILK_AMOUNT_MISMATCH"],
    [{ preparedMilkAmount: 120, milkAmount: 140 }, "CONSUMED_EXCEEDS_PREPARED"],
    [{ milkAmount: -1 }, "INVALID_NUMBER"],
    [{ milkAmount: Number.NaN }, "INVALID_NUMBER"],
  ] as const)("retains a clarification conflict for contradictory amount %o", (fields, code) => {
    expect(evaluate({ ...bottle, ...fields }).conflicts.map(item => item.code)).toContain(code);
  });
  it("accepts genuine amounts beyond old sliders and rejects fractional counts", () => {
    expect(evaluate({ ...bottle, preparedMilkAmount: 321.5, milkAmount: 301.5 }).conflicts).toEqual([]);
    expect(evaluate({ type: "ROLL_OVER", startTime, count: 1.5 }).conflicts[0]?.code).toBe("INVALID_NUMBER");
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
    const input = { facts: { ...bottle, preparedMilkAmount: 120, remainingMilkAmount: 120, sameBottle: true }, states: { milkAmount: "unknown" as const } };
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
