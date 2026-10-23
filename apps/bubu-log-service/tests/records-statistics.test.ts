import { describe, expect, it } from "vitest";
import { activityInDate, affectedDates, chinaDayRange, computeStatistics, isActivityOngoing } from "../src/records/statistics";
import type { CareEvent, LegacyActivity } from "../src/records/types";

const startTime = "2026-10-22T10:00:00+08:00";
const activity = (id: string, facts: Partial<LegacyActivity>): LegacyActivity => ({ id, babyId: "baby-1", type: "BOTTLE", startTime, endTime: "2026-10-22T10:15:00+08:00", ...facts });
function managed(value: LegacyActivity, overrides: Partial<CareEvent> = {}): CareEvent {
  return { id: `event-${value.id}`, legacyId: value.id, babyId: value.babyId, version: 1, facts: value, states: {}, progress: "ended", evidence: [], missing: [], conflicts: [], complete: true,
    lifecycle: "active", duplicateCandidates: [], sources: [], attachmentIds: [], actor: { kind: "caregiver", id: "p1", sessionId: "s1" }, projection: "synced", projected: value, createdAt: startTime, updatedAt: startTime, ...overrides };
}
describe("legacy metrics plus independent coverage", () => {
  it("splits a 90-minute midnight sleep into 30/60 without counting ongoing time as final", () => {
    const sleep = activity("sleep", { type: "SLEEP", startTime: "2026-10-21T23:30:00+08:00", endTime: "2026-10-22T01:00:00+08:00" });
    const ongoing = activity("ongoing", { type: "SLEEP", endTime: null });
    expect(computeStatistics([sleep], "2026-10-21").metrics.totalSleepMinutes).toBe(30);
    const stats = computeStatistics([sleep, ongoing], "2026-10-22", [managed(ongoing, { progress: "ongoing", complete: true, states: { endTime: "not_yet" } })]);
    expect(stats.metrics.totalSleepMinutes).toBe(60);
    expect(stats.metrics.sleepCount).toBe(1);
    expect(stats.coverage.ongoingEvents).toBe(1);
    expect(affectedDates([sleep])).toEqual(["2026-10-21", "2026-10-22"]);
  });
  it("carries explicitly ongoing sleep across midnight only through now, then splits its confirmed end", () => {
    const sleep = activity("night", { type: "SLEEP", startTime: "2026-10-22T23:30:00+08:00", endTime: null });
    const event = managed(sleep, { progress: "ongoing", states: { endTime: "not_yet", durationMinutes: "not_yet" } });
    const now = Date.parse("2026-10-23T00:30:00+08:00");
    const current = computeStatistics([sleep], "2026-10-23", [event], now);
    expect(current.metrics.totalSleepMinutes).toBe(0);
    expect(current.coverage).toMatchObject({ recordedEvents: 1, ongoingEvents: 1 });
    expect(current.byType.SLEEP).toMatchObject({ events: 1, ongoingEvents: 1, knownMinutes: 0, knownDurations: 0 });
    expect(computeStatistics([sleep], "2026-10-24", [event], now).coverage.recordedEvents).toBe(0);
    expect(computeStatistics([sleep], "2026-10-23", [], now).coverage.recordedEvents).toBe(0);
    expect(computeStatistics([sleep], "2026-10-22", [], now).byType.SLEEP).toMatchObject({ unknownDurations: 1, ongoingEvents: 0 });
    const ended = { ...sleep, endTime: "2026-10-23T01:00:00+08:00" };
    const confirmed = managed(ended, { states: { endTime: "known" } });
    expect(computeStatistics([ended], "2026-10-22", [confirmed], now).metrics.totalSleepMinutes).toBe(30);
    const after = computeStatistics([ended], "2026-10-23", [confirmed], now);
    expect(after.metrics.totalSleepMinutes).toBe(60);
    expect(after.coverage.ongoingEvents).toBe(0);
    // An externally saved end remains factual even before metadata reconciliation.
    const externalEnd = computeStatistics([ended], "2026-10-23", [event], now);
    expect(externalEnd.metrics.totalSleepMinutes).toBe(60);
    expect(externalEnd.coverage.ongoingEvents).toBe(0);
    expect(externalEnd.byType.SLEEP?.ongoingEvents).toBe(0);
    expect(isActivityOngoing(ended, event)).toBe(false);
    expect(activityInDate(ended, "2026-10-24", isActivityOngoing(ended, event), now + 86400000)).toBe(false);
    expect(computeStatistics([ended], "2026-10-24", [event], now + 86400000).coverage).toMatchObject({ recordedEvents: 0, ongoingEvents: 0 });
  });
  it("does not extend a moved or externally deleted activity using stale ongoing metadata", () => {
    const original = activity("moved", { type: "SLEEP", endTime: null });
    const event = managed(original, { progress: "ongoing", states: { endTime: "not_yet" } });
    const moved = { ...original, startTime: "2026-10-23T10:00:00+08:00" };
    const now = Date.parse("2026-10-24T12:00:00+08:00");
    expect(isActivityOngoing(moved, event)).toBe(false);
    expect(computeStatistics([moved], "2026-10-22", [event], now).coverage.recordedEvents).toBe(0);
    expect(computeStatistics([moved], "2026-10-23", [event], now).coverage.ongoingEvents).toBe(0);
    expect(computeStatistics([moved], "2026-10-24", [event], now).byType.SLEEP?.events).toBe(0);
    expect(computeStatistics([], "2026-10-22", [event], now).coverage.ongoingEvents).toBe(0);
  });
  it("reflects values supplied by the old site instead of retaining stale unknown or missing coverage", () => {
    const original = activity("unknown-old", { milkAmount: null, endTime: null });
    const event = managed(original, { complete: false, states: { milkAmount: "unknown", endTime: "pending", durationMinutes: "unknown" } });
    const filled = { ...original, milkAmount: 125, endTime: "2026-10-22T10:15:00+08:00" };
    const stats = computeStatistics([filled], "2026-10-22", [event]);
    expect(stats.metrics.totalMilkAmount).toBe(125);
    expect(stats.coverage).toMatchObject({ incompleteEvents: 0, pendingFields: 0, unknownFields: 0, unknownMilkAmounts: 0, knownMilkAmounts: 1 });
  });
  it("keeps unfinished milk amounts separate from unknown final quantities", () => {
    const pump = activity("pumping", { type: "PUMP", milkAmount: null, endTime: null });
    const event = managed(pump, { progress: "ongoing", states: { milkAmount: "not_yet", endTime: "not_yet" } });
    const stats = computeStatistics([pump], "2026-10-22", [event]);
    expect(stats.coverage).toMatchObject({ ongoingEvents: 1, unknownMilkAmounts: 0 });
    expect(stats.byType.PUMP).toMatchObject({ ongoingEvents: 1, knownMilkAmounts: 0, unknownMilkAmounts: 0 });
    const ended = computeStatistics([{ ...pump, endTime: "2026-10-22T10:15:00+08:00" }], "2026-10-22", [event]);
    expect(ended.coverage).toMatchObject({ ongoingEvents: 0, incompleteEvents: 1, pendingFields: 1, unknownMilkAmounts: 1 });
  });
  it("counts known intake despite missing burp, preserves zero and excludes unknown/pump/prepared from intake", () => {
    const bottle = activity("b1", { milkAmount: 100, milkSource: "FORMULA" }); const zero = activity("zero", { milkAmount: 0 });
    const unknown = activity("unknown", { milkAmount: null }); const pump = activity("pump", { type: "PUMP", milkAmount: 80 });
    const stats = computeStatistics([bottle, zero, unknown, pump], "2026-10-22", [managed(bottle, { complete: false, states: { milkAmount: "known", burpSuccess: "pending", preparedMilkAmount: "known" }, facts: { ...bottle, milkSource: "FORMULA", preparedMilkAmount: 120 } }), managed(unknown, { complete: false, states: { milkAmount: "unknown" } })]);
    expect(stats.metrics.totalMilkAmount).toBe(100);
    expect(stats.metrics.totalPumpMilkAmount).toBe(80);
    expect(stats.coverage.knownZeroMilkAmounts).toBe(1);
    expect(stats.coverage.unknownMilkAmounts).toBe(1);
    expect(stats.coverage.incompleteEvents).toBe(2);
    expect(stats.byType.BOTTLE?.preparedMilkAmount).toBe(120);
  });
  it("excludes suspected duplicate candidates, merged and retracted projections until resolved", () => {
    const original = activity("original", { milkAmount: 100 }); const suspect = activity("suspect", { milkAmount: 100 });
    const events = [managed(suspect, { duplicateCandidates: [original.id], projection: "candidate", projected: null })];
    expect(computeStatistics([original, suspect], "2026-10-22", events).metrics.totalMilkAmount).toBe(100);
    expect(computeStatistics([original, suspect], "2026-10-22", events).coverage.duplicateCandidates).toBe(1);
    expect(computeStatistics([original, suspect], "2026-10-22", [managed(suspect)]).metrics.totalMilkAmount).toBe(200);
    expect(computeStatistics([original, suspect], "2026-10-22", [managed(suspect, { lifecycle: "retracted" })]).metrics.totalMilkAmount).toBe(100);
  });
  it("reports actual diapers, urine and stool separately without urine-size conversion", () => {
    const rows = [activity("small", { type: "DIAPER", endTime: startTime, hasPee: true, hasPoop: false, peeAmount: "SMALL" }), activity("medium", { type: "DIAPER", endTime: startTime, hasPee: true, hasPoop: true, peeAmount: "MEDIUM" })];
    expect(computeStatistics(rows, "2026-10-22").metrics).toMatchObject({ diaperCount: 2, peeCount: 2, poopCount: 1 });
  });
  it("retains saved facts while a contradictory revision awaits clarification", () => {
    const original = activity("saved", { milkAmount: 100 });
    const candidate = managed(original, { facts: { ...original, milkAmount: -10 }, projection: "conflict", complete: false, states: { milkAmount: "pending" }, conflicts: [{ code: "INVALID_NUMBER", fields: ["milkAmount"], message: "需核对" }] });
    expect(computeStatistics([original], "2026-10-22", [candidate]).metrics.totalMilkAmount).toBe(100);
    expect(computeStatistics([original], "2026-10-22", [candidate]).coverage.pendingCandidates).toBe(1);
  });
  it("preserves old exercise metrics and adds explicit counts for the two count activities", () => {
    const stats = computeStatistics([activity("r", { type: "ROLL_OVER", count: 3, endTime: startTime }), activity("p", { type: "PULL_TO_SIT", count: 0, endTime: startTime }), activity("u", { type: "ROLL_OVER", count: null, endTime: startTime })], "2026-10-22");
    expect(stats.metrics.exerciseCount).toBe(0);
    expect(stats.byType.ROLL_OVER).toMatchObject({ events: 2, knownCount: 3, unknownCount: 1 });
    expect(stats.byType.PULL_TO_SIT).toMatchObject({ events: 1, knownCount: 0, unknownCount: 0 });
  });
  it("rejects calendar overflow and does not count a midnight point on the prior day", () => {
    expect(() => chinaDayRange("2026-02-30")).toThrow();
    const midnight = activity("m", { type: "DIAPER", startTime: "2026-10-23T00:00:00+08:00", endTime: "2026-10-23T00:00:00+08:00" });
    expect(computeStatistics([midnight], "2026-10-22").metrics.diaperCount).toBe(0);
  });
});
