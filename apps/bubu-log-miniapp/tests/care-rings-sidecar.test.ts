import { describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/taro", () => ({ default: {} }));

import { buildCareMonthRings, type CareRingCalendarDay, type CareRingMetric } from "../src/model/care-rings";
import type { Activity, DailyStat, RecordCoverage, RecordTypeSummary } from "../src/model/types";
import { DEFAULT_CARE_PREFERENCES, type CarePreferences } from "../src/preferences/care-preferences";

const summary = (extra: Partial<RecordTypeSummary> = {}): RecordTypeSummary => ({
  events: 0,
  knownMinutes: 0,
  knownCount: 0,
  unknownCount: 0,
  knownMilkAmount: 0,
  preparedMilkAmount: 0,
  knownMilkAmounts: 0,
  unknownMilkAmounts: 0,
  knownDurations: 0,
  unknownDurations: 0,
  ongoingEvents: 0,
  ...extra,
});

const coverage = (extra: Partial<RecordCoverage> = {}): RecordCoverage => ({
  recordedEvents: 0,
  incompleteEvents: 0,
  pendingFields: 0,
  unknownFields: 0,
  ongoingEvents: 0,
  pendingCandidates: 0,
  duplicateCandidates: 0,
  unresolvedTime: 0,
  knownMilkAmounts: 0,
  unknownMilkAmounts: 0,
  knownZeroMilkAmounts: 0,
  eventsWithUnknownFields: [],
  pendingEventIds: [],
  ...extra,
});

const dailyStat = (date: string, extra: Partial<DailyStat> = {}): DailyStat => ({
  id: date,
  date,
  sleepCount: 0,
  totalSleepMinutes: 0,
  totalMilkAmount: 0,
  totalPumpMilkAmount: 0,
  diaperCount: 0,
  coverage: coverage(),
  byType: {},
  ...extra,
});

const activity = (id: string, type: Activity["type"], startTime: string, extra: Partial<Activity> = {}): Activity => ({
  id,
  type,
  startTime,
  ...extra,
});

const preferences = (): CarePreferences => ({
  breastfeedRate: DEFAULT_CARE_PREFERENCES.breastfeedRate,
  milkReference: null,
  sleepReference: null,
});

function build(options: Partial<Parameters<typeof buildCareMonthRings>[0]> = {}) {
  return buildCareMonthRings({
    activities: [],
    activitiesComplete: true,
    stats: [],
    monthDate: "2026-02-10",
    today: "2026-02-15",
    birthDate: null,
    preferences: preferences(),
    ...options,
  });
}

function day(result: ReturnType<typeof build>, date: string): CareRingCalendarDay {
  const found = result.weeks.flatMap((week) => week.days).find((cell) => cell.date === date);
  expect(found).toBeTruthy();
  return found!;
}

function metric<K extends CareRingMetric["key"]>(
  result: ReturnType<typeof build>,
  date: string,
  key: K,
): Extract<CareRingMetric, { key: K }> {
  const found = day(result, date).metrics.find((item) => item.key === key);
  expect(found).toBeTruthy();
  return found as Extract<CareRingMetric, { key: K }>;
}

describe("sidecar care ring metadata", () => {
  it("normalizes an ISO stat date and keeps an empty sidecar day unknown", () => {
    const stat = dailyStat("2026-02-01T00:30:00+08:00");
    const cell = day(build({ stats: [stat] }), "2026-02-01");

    expect(cell.savedStat).toBe(stat);
    expect(cell.dataState).toBe("unknown");
    for (const item of cell.metrics) {
      expect(item.dataState).toBe("unknown");
      expect(item.value.type).toBe("unknown");
      expect(item.progress).toBeNull();
    }
    expect(metric(build({ stats: [stat] }), "2026-02-01", "milk").bottleMl).toBeNull();
  });

  it("does not turn an unknown bottle amount into a known zero total", () => {
    const stat = dailyStat("2026-02-02", {
      byType: { BOTTLE: summary({ events: 1, unknownMilkAmounts: 1 }) },
    });
    const milk = metric(build({ stats: [stat] }), "2026-02-02", "milk");

    expect(milk.bottleMl).toBeNull();
    expect(milk.value).toMatchObject({ type: "unknown" });
    expect(milk.progress).toBeNull();
    expect(milk.readableComponents).toEqual(["瓶喂未知", "亲喂未知"]);
  });

  it("keeps ongoing sleep unknown instead of displaying completed zero minutes", () => {
    const stat = dailyStat("2026-02-03", {
      byType: { SLEEP: summary({ events: 1, ongoingEvents: 1 }) },
    });
    const sleep = metric(build({ stats: [stat] }), "2026-02-03", "sleep");

    expect(sleep.savedMinutes).toBeNull();
    expect(sleep.value).toMatchObject({ type: "unknown" });
    expect(sleep.readableValue).toBe("未知");
    expect(sleep.progress).toBeNull();
    expect(sleep.dataState).toBe("unknown");
  });

  it("keeps a known subtotal distinguishable when another sleep duration is unknown", () => {
    const stat = dailyStat("2026-02-04", {
      totalSleepMinutes: 480,
      byType: { SLEEP: summary({ events: 2, knownDurations: 1, unknownDurations: 1 }) },
    });
    const sleep = metric(build({ stats: [stat] }), "2026-02-04", "sleep");

    expect(sleep.savedMinutes).toBe(480);
    expect(sleep.value).toMatchObject({ type: "unknown" });
    expect(sleep.readableValue).toBe("未知（已完成 8小时、1 条待补全）");
    expect(sleep.progress).toBeNull();
    expect(sleep.dataState).toBe("partial");
    expect(day(build({ stats: [stat] }), "2026-02-04").dataState).toBe("partial");
  });

  it("keeps explicit completed zeros and actual sidecar event counts", () => {
    const stat = dailyStat("2026-02-05", {
      diaperCount: 99,
      byType: {
        SLEEP: summary({ events: 1, knownDurations: 1 }),
        OUTDOOR: summary({ events: 1, knownDurations: 1 }),
        DIAPER: summary({ events: 3 }),
      },
    });
    const result = build({
      stats: [stat],
      activities: [activity("outdoor-zero", "OUTDOOR", "2026-02-05 10:00", { endTime: "2026-02-05 10:00" })],
    });

    expect(metric(result, "2026-02-05", "sleep")).toMatchObject({
      savedMinutes: 0,
      value: { type: "number", value: 0 },
      dataState: "known",
    });
    expect(metric(result, "2026-02-05", "outdoor")).toMatchObject({
      recordedMinutes: 0,
      recordCount: 1,
      value: { type: "number", value: 0 },
      dataState: "known",
    });
    expect(metric(result, "2026-02-05", "diaper")).toMatchObject({
      count: 3,
      value: { type: "number", value: 3 },
      readableValue: "3 次",
      dataState: "known",
    });
  });

  it("shows a known bottle subtotal but no total or progress when another bottle amount is unknown", () => {
    const stat = dailyStat("2026-02-06", {
      totalMilkAmount: 120,
      byType: { BOTTLE: summary({ events: 2, knownMilkAmounts: 1, unknownMilkAmounts: 1 }) },
    });
    const milk = metric(build({ stats: [stat] }), "2026-02-06", "milk");

    expect(milk.bottleMl).toBe(120);
    expect(milk.value).toMatchObject({ type: "unknown" });
    expect(milk.progress).toBeNull();
    expect(milk.dataState).toBe("partial");
    expect(milk.readableComponents).toEqual(["瓶喂已知 120 ml，1 次奶量未知", "亲喂未知"]);
  });

  it("preserves explicit and estimated breastfeed components without inventing bottle zero", () => {
    const explicit = dailyStat("2026-02-07", {
      breastfeedCount: 1,
      byType: { BREASTFEED: summary({ events: 1 }) },
    });
    const explicitMetric = metric(build({
      stats: [explicit],
      activities: [activity("bf", "BREASTFEED", "2026-02-07 10:00", { milkAmount: 80 })],
    }), "2026-02-07", "milk");
    expect(explicitMetric.bottleMl).toBeNull();
    expect(explicitMetric.breastfeed).toMatchObject({ state: "known", explicitMl: 80 });
    expect(explicitMetric.readableComponents).toEqual(["瓶喂未知", "亲喂记录量 80 ml"]);

    const estimated = dailyStat("2026-02-08", {
      breastfeedCount: 1,
      totalBreastfeedMinutes: 10,
      byType: { BREASTFEED: summary({ events: 1, knownDurations: 1 }) },
    });
    const estimatedMetric = metric(build({
      birthDate: "2025-10-01",
      stats: [estimated],
      activities: [activity("bf", "BREASTFEED", "2026-02-08 10:00", { endTime: "2026-02-08 10:10" })],
    }), "2026-02-08", "milk");
    expect(estimatedMetric.bottleMl).toBeNull();
    expect(estimatedMetric.breastfeed.estimatedRange).toEqual({ min: 50, max: 100 });
    expect(estimatedMetric.value).toMatchObject({ type: "unknown" });
    expect(estimatedMetric.readableComponents).toEqual(["瓶喂未知", "亲喂估算 50–100 ml"]);
  });

  it("treats missing, open, and incomplete outdoor events as unknown", () => {
    const missing = metric(build({
      stats: [dailyStat("2026-02-09")],
    }), "2026-02-09", "outdoor");
    expect(missing.value).toMatchObject({ type: "unknown" });
    expect(missing.dataState).toBe("unknown");

    const open = metric(build({
      stats: [dailyStat("2026-02-10", { byType: { OUTDOOR: summary({ events: 1, ongoingEvents: 1 }) } })],
    }), "2026-02-10", "outdoor");
    expect(open.recordedMinutes).toBeNull();
    expect(open.value).toMatchObject({ type: "unknown" });
    expect(open.dataState).toBe("unknown");

    const incomplete = metric(build({
      stats: [dailyStat("2026-02-11", {
        byType: { OUTDOOR: summary({ events: 2, knownDurations: 1, unknownDurations: 1, knownMinutes: 30 }) },
      })],
      activities: [
        activity("outdoor-known", "OUTDOOR", "2026-02-11 08:00", { endTime: "2026-02-11 08:30" }),
        activity("outdoor-unknown", "OUTDOOR", "2026-02-11 09:00"),
      ],
    }), "2026-02-11", "outdoor");
    expect(incomplete.recordedMinutes).toBe(30);
    expect(incomplete.readableValue).toBe("未知（已知 30分钟、1 条待补全）");
    expect(incomplete.progress).toBeNull();
    expect(incomplete.dataState).toBe("partial");
  });

  it("unions overlapping outdoor intervals instead of summing sidecar known minutes", () => {
    const result = build({
      stats: [dailyStat("2026-02-13", {
        byType: { OUTDOOR: summary({ events: 2, knownDurations: 2, knownMinutes: 120 }) },
      })],
      activities: [
        activity("first", "OUTDOOR", "2026-02-13 08:00", { endTime: "2026-02-13 09:00" }),
        activity("second", "OUTDOOR", "2026-02-13 08:30", { endTime: "2026-02-13 09:30" }),
      ],
    });

    expect(metric(result, "2026-02-13", "outdoor")).toMatchObject({
      recordedMinutes: 90,
      recordCount: 2,
      value: { type: "number", value: 90 },
      progress: 0.5,
      dataState: "known",
    });
  });

  it("clips a known cross-midnight outdoor interval on both days", () => {
    const result = build({
      monthDate: "2026-10-01",
      today: "2026-10-31",
      stats: [
        dailyStat("2026-10-22", {
          byType: { OUTDOOR: summary({ events: 1, knownDurations: 1, knownMinutes: 60 }) },
        }),
        dailyStat("2026-10-23", {
          byType: { OUTDOOR: summary({ events: 0, knownDurations: 0 }) },
        }),
      ],
      activities: [
        activity("cross", "OUTDOOR", "2026-10-22 23:30", { endTime: "2026-10-23 00:30" }),
      ],
    });

    expect(metric(result, "2026-10-22", "outdoor")).toMatchObject({
      recordedMinutes: 30,
      recordCount: 1,
      value: { type: "number", value: 30 },
      dataState: "known",
    });
    expect(metric(result, "2026-10-23", "outdoor")).toMatchObject({
      recordedMinutes: 30,
      recordCount: 1,
      value: { type: "number", value: 30 },
      dataState: "known",
    });
  });

  it("keeps a mixed ended-and-ongoing outdoor day partial with its known subtotal", () => {
    const result = build({
      stats: [dailyStat("2026-02-14", {
        byType: { OUTDOOR: summary({ events: 2, knownDurations: 1, ongoingEvents: 1, knownMinutes: 30 }) },
      })],
      activities: [
        activity("ended", "OUTDOOR", "2026-02-14 08:00", { endTime: "2026-02-14 08:30" }),
        activity("ongoing", "OUTDOOR", "2026-02-14 09:00"),
      ],
    });

    expect(metric(result, "2026-02-14", "outdoor")).toMatchObject({
      recordedMinutes: 30,
      recordCount: 2,
      value: { type: "unknown" },
      readableValue: "未知（已知 30分钟、1 条进行中）",
      progress: null,
      dataState: "partial",
    });
  });

  it("does not turn an actually ongoing outdoor event into a known-zero subtotal", () => {
    const outdoor = metric(build({
      stats: [dailyStat("2026-02-10", {
        byType: {
          OUTDOOR: summary({
            events: 1,
            knownDurations: 0,
            ongoingEvents: 1,
            knownMinutes: 0,
          }),
        },
      })],
      activities: [
        activity("ongoing", "OUTDOOR", "2026-02-10 08:00"),
      ],
    }), "2026-02-10", "outdoor");

    expect(outdoor).toMatchObject({
      recordedMinutes: null,
      recordCount: 1,
      value: { type: "unknown" },
      readableValue: "未知",
      progress: null,
      dataState: "unknown",
    });
  });

  it("does not turn an outdoor event without an end into an unknown-duration subtotal", () => {
    const outdoor = metric(build({
      stats: [dailyStat("2026-02-12", {
        byType: {
          OUTDOOR: summary({
            events: 1,
            knownDurations: 0,
            unknownDurations: 1,
            knownMinutes: 0,
          }),
        },
      })],
      activities: [
        activity("no-end", "OUTDOOR", "2026-02-12 08:00"),
      ],
    }), "2026-02-12", "outdoor");

    expect(outdoor).toMatchObject({
      recordedMinutes: null,
      recordCount: 1,
      value: { type: "unknown" },
      readableValue: "未知",
      progress: null,
      dataState: "unknown",
    });
  });

  it("keeps an incomplete activity list partial without treating its subtotal as the daily total", () => {
    const result = build({
      stats: [dailyStat("2026-02-15", {
        byType: { OUTDOOR: summary({ events: 2, knownDurations: 2, knownMinutes: 50 }) },
      })],
      activities: [
        activity("available", "OUTDOOR", "2026-02-15 08:00", { endTime: "2026-02-15 08:30" }),
      ],
      activitiesComplete: false,
    });

    expect(metric(result, "2026-02-15", "outdoor")).toMatchObject({
      recordedMinutes: 30,
      recordCount: 2,
      value: { type: "unknown" },
      readableValue: "未知（已知 30分钟、1 条缺少明细、本月部分记录尚未读取完整）",
      progress: null,
      dataState: "partial",
    });
  });

  it("keeps legacy output unchanged when optional sidecar metadata is absent", () => {
    const stat = dailyStat("2026-02-12", {
      totalMilkAmount: 500,
      breastfeedCount: 0,
      totalBreastfeedMinutes: 0,
    });
    const legacy = { ...stat };
    delete legacy.coverage;
    delete legacy.byType;
    const cell = day(build({ stats: [legacy] }), "2026-02-12");

    expect(cell.dataState).toBe("known");
    expect(cell.metrics.find((item) => item.key === "milk")?.value).toEqual({ type: "number", value: 500 });
    expect(cell.metrics.find((item) => item.key === "sleep")?.value).toEqual({ type: "number", value: 0 });
    expect(cell.metrics.find((item) => item.key === "diaper")?.value).toEqual({ type: "number", value: 0 });
  });
});
