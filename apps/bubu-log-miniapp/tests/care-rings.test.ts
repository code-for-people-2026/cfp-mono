import { describe, expect, it, vi } from "vitest";

vi.mock("@tarojs/taro", () => ({ default: {} }));
import { buildCareMonthRings, type CareRingCalendarDay } from "../src/model/care-rings";
import type { Activity, DailyStat } from "../src/model/types";
import {
  DEFAULT_CARE_PREFERENCES, carePreferencesStorageKey,
  getCarePreferences, saveCarePreferences, validateCarePreferences,
  CarePreferencesStorageFailure, type CarePreferences, type CarePreferencesStorage,
} from "../src/preferences/care-preferences";

const activity = (id: string, type: Activity["type"], startTime: string, extra: Partial<Activity> = {}): Activity => ({
  id, type, startTime, ...extra,
});
const dailyStat = (date: string, extra: Partial<DailyStat> = {}): DailyStat => ({
  id: date, date, sleepCount: 0, totalSleepMinutes: 0, totalMilkAmount: 0,
  totalPumpMilkAmount: 0, diaperCount: 0, ...extra,
});
const preferences = (breastfeedRate: CarePreferences["breastfeedRate"] = DEFAULT_CARE_PREFERENCES.breastfeedRate): CarePreferences => ({
  breastfeedRate, milkReference: null, sleepReference: null,
});
const customRate = { mode: "custom" as const, range: { min: 4, max: 6 }, source: "user-custom" as const };
const offRate = { mode: "off" as const, range: null, source: "user-disabled" as const };

function build(options: Partial<Parameters<typeof buildCareMonthRings>[0]> = {}) {
  return buildCareMonthRings({
    activities: [], activitiesComplete: true, stats: [], monthDate: "2026-02-10",
    today: "2026-02-15", birthDate: null, preferences: preferences(), ...options,
  });
}

function day(result: ReturnType<typeof build>, date: string): CareRingCalendarDay {
  const found = result.weeks.flatMap((week) => week.days).find((cell) => cell.date === date);
  expect(found).toBeTruthy();
  return found!;
}

function milk(result: ReturnType<typeof build>, date: string) {
  const found = day(result, date).metrics[0];
  expect(found.key).toBe("milk");
  return found;
}

function outdoor(result: ReturnType<typeof build>, date: string) {
  const found = day(result, date).metrics[2];
  expect(found.key).toBe("outdoor");
  return found;
}

describe("care ring dates and ages", () => {
  it("normalizes Shanghai ISO stat dates, keeps duplicate last rows, and never mutates inputs", () => {
    const first = dailyStat("2026-02-01T00:30:00+08:00", { totalMilkAmount: 20 });
    const second = dailyStat("2026-01-31T16:30:00Z", { totalMilkAmount: 30 });
    const invalid = dailyStat("not-a-date");
    const stats = [first, second, invalid];
    const before = JSON.stringify(stats);
    const result = build({ stats });

    expect(day(result, "2026-02-01").savedStat).toBe(second);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate-stat-date", date: "2026-02-01" }),
        expect.objectContaining({ code: "invalid-stat" }),
      ]),
    );
    expect(JSON.stringify(stats)).toBe(before);
  });

  it("rejects impossible timestamp calendar days and normalizes an ISO birthday", () => {
    const impossible = build({ stats: [dailyStat("2026-02-30T00:00:00Z")] });
    expect(day(impossible, "2026-02-01").savedStat).toBeNull();
    expect(impossible.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-stat" })]));

    expect(day(build({ birthDate: "2026-01-31T16:30:00Z" }), "2026-02-28").age)
      .toMatchObject({ state: "known", birthDate: "2026-02-01", completeMonths: 0, days: 27 });
  });

  it("derives historical today/month bounds and clamps month-end anniversaries", () => {
    const historical = build({ monthDate: "2026-01-10", today: "2026-02-15T00:30:00+08:00" });
    expect(historical.month).toMatchObject({ first: "2026-01-01", last: "2026-01-31", today: "2026-02-15" });
    expect(day(historical, "2026-01-02").isPast).toBe(true);

    expect(day(build({ birthDate: "2026-01-31" }), "2026-02-28").age).toMatchObject({ state: "known", completeMonths: 1 });
    expect(day(build({ monthDate: "2025-02-10", birthDate: "2024-02-29" }), "2025-02-28").age)
      .toMatchObject({ state: "known", completeMonths: 12 });
    expect(day(build({ birthDate: "2026-02-20" }), "2026-02-15").age.state).toBe("future");
  });
});

describe("care ring milk estimation", () => {
  it("accepts explicit breastfeed amount zero", () => {
    const result = build({
      birthDate: "2025-10-01",
      stats: [dailyStat("2026-02-02", { totalMilkAmount: 500, breastfeedCount: 1 })],
      activities: [activity("bf", "BREASTFEED", "2026-02-02 10:00", { milkAmount: 0 })],
    });
    const metric = milk(result, "2026-02-02");
    expect(metric.breastfeed).toMatchObject({ state: "known", explicitMl: 0, recordedMinutes: 0 });
    expect(metric.value).toEqual({ type: "number", value: 500 });
    expect(metric.readableComponents).toEqual(["瓶喂 500 ml", "亲喂记录量 0 ml"]);
  });

  it("adds ten estimated breastfeed minutes to a known 500 ml bottle", () => {
    const result = build({
      birthDate: "2025-10-01",
      stats: [dailyStat("2026-02-02", { totalMilkAmount: 500, breastfeedCount: 1, totalBreastfeedMinutes: 10 })],
      activities: [activity("bf", "BREASTFEED", "2026-02-02 10:00", { endTime: "2026-02-02 10:10" })],
    });
    expect(milk(result, "2026-02-02").value).toEqual({ type: "range", range: { min: 550, max: 600 } });
  });

  it("matches backend per-record breastfeed rounding while estimating from raw durations", () => {
    const fractionalFeeds = (durationSeconds: number) => [0, 1, 2, 3, 4].map((index) => activity(
      `down-${index}`, "BREASTFEED", `2026-02-02 10:0${index}:00`,
      { endTime: `2026-02-02 10:${String(index + 10).padStart(2, "0")}:${String(durationSeconds).padStart(2, "0")}` },
    ));

    const roundingDown = build({
      birthDate: "2026-01-01",
      stats: [dailyStat("2026-02-02", { breastfeedCount: 5, totalBreastfeedMinutes: 50 })],
      activities: fractionalFeeds(24),
    });
    const downMetric = milk(roundingDown, "2026-02-02");
    expect(downMetric.breastfeed).toMatchObject({
      state: "estimated", recordedMinutes: 52, estimatedRange: { min: 260, max: 520 },
    });
    expect(roundingDown.issues.filter((issue) => issue.code === "breastfeed-mismatch")).toEqual([]);

    const roundingUp = build({
      birthDate: "2026-01-01",
      stats: [dailyStat("2026-02-02", { breastfeedCount: 5, totalBreastfeedMinutes: 55 })],
      activities: fractionalFeeds(36),
    });
    expect(milk(roundingUp, "2026-02-02").breastfeed).toMatchObject({
      state: "estimated", recordedMinutes: 53, estimatedRange: { min: 265, max: 530 },
    });
    expect(roundingUp.issues.filter((issue) => issue.code === "breastfeed-mismatch")).toEqual([]);
  });

  it("still detects a genuine breastfeed duration mismatch after per-record rounding", () => {
    const feeds = [0, 1, 2, 3, 4].map((index) => activity(
      `mismatch-${index}`, "BREASTFEED", `2026-02-02 10:0${index}:00`,
      { endTime: `2026-02-02 10:${10 + index}:24` },
    ));
    const result = build({
      birthDate: "2026-01-01",
      stats: [dailyStat("2026-02-02", { breastfeedCount: 5, totalBreastfeedMinutes: 70 })],
      activities: feeds,
    });

    expect(milk(result, "2026-02-02").breastfeed.state).toBe("partial");
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "breastfeed-mismatch", metric: "milk" }),
    ]));
  });

  it("blocks default research estimates for unknown or first-week ages, but honors explicit custom rates", () => {
    const feed = activity("bf", "BREASTFEED", "2026-02-02 10:00", { endTime: "2026-02-02 10:10" });
    const stats = [dailyStat("2026-02-02", { totalMilkAmount: 500, breastfeedCount: 1, totalBreastfeedMinutes: 10 })];
    expect(milk(build({ activities: [feed], stats }), "2026-02-02").breastfeed.state).toBe("blocked");
    expect(milk(build({ activities: [feed], stats, birthDate: "2026-02-01" }), "2026-02-02").breastfeed.state).toBe("blocked");
    expect(milk(build({ activities: [feed], stats, preferences: preferences(customRate) }), "2026-02-02").value)
      .toEqual({ type: "range", range: { min: 540, max: 560 } });
  });

  it("keeps bottle known but total unknown when estimation is off and breastfeed has duration only", () => {
    const result = build({
      stats: [dailyStat("2026-02-02", { totalMilkAmount: 500, breastfeedCount: 1, totalBreastfeedMinutes: 10 })],
      activities: [activity("bf", "BREASTFEED", "2026-02-02 10:00", { endTime: "2026-02-02 10:10" })],
      preferences: preferences(offRate),
    });
    const metric = milk(result, "2026-02-02");
    expect(metric.bottleMl).toBe(500);
    expect(metric.breastfeed.state).toBe("off");
    expect(metric.value.type).toBe("unknown");
  });

  it("marks invalid or mismatched saved breastfeed data partial without inventing records", () => {
    const invalid = build({
      stats: [dailyStat("2026-02-02", { breastfeedCount: 1.5, totalBreastfeedMinutes: Number.NaN })],
      activities: [activity("bf", "BREASTFEED", "2026-02-02 10:00", { endTime: "2026-02-02 10:10" })],
    });
    expect(milk(invalid, "2026-02-02").breastfeed.state).toBe("partial");

    const missing = build({ stats: [dailyStat("2026-02-02", { breastfeedCount: 2, totalBreastfeedMinutes: 20 })] });
    expect(milk(missing, "2026-02-02").breastfeed.state).toBe("partial");
    expect(missing.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "breastfeed-mismatch" })]));

    const durationMismatch = build({
      stats: [dailyStat("2026-02-02", { breastfeedCount: 1, totalBreastfeedMinutes: 30 })],
      activities: [activity("bf", "BREASTFEED", "2026-02-02 10:00", { endTime: "2026-02-02 10:10" })],
    });
    expect(milk(durationMismatch, "2026-02-02").breastfeed.state).toBe("partial");

    const omittedDuration = build({
      stats: [dailyStat("2026-02-02", { breastfeedCount: 1, totalBreastfeedMinutes: 30 })],
      activities: [activity("bf", "BREASTFEED", "2026-02-02 10:00", { milkAmount: 80 })],
    });
    expect(milk(omittedDuration, "2026-02-02").breastfeed.state).toBe("known");
    expect(milk(omittedDuration, "2026-02-02").value).toEqual({ type: "number", value: 80 });
  });

  it("treats saved zero breastfeed as known zero but missing snapshots as unknown", () => {
    const zero = build({
      stats: [dailyStat("2026-02-03", { totalMilkAmount: 200, breastfeedCount: 0, totalBreastfeedMinutes: 0 })],
    });
    expect(milk(zero, "2026-02-03").value).toEqual({ type: "number", value: 200 });
    expect(milk(build(), "2026-02-03").value.type).toBe("unknown");
    expect(milk(build(), "2026-02-03").readableComponents).toEqual(["瓶喂未知", "亲喂记录量 0 ml"]);
  });
});

describe("care ring outdoor data", () => {
  it("unions clamped outdoor intervals and dedupes repeated activity IDs", () => {
    const result = build({
      stats: [dailyStat("2026-02-01")],
      activities: [
        activity("cross", "OUTDOOR", "2026-01-31 23:30", { endTime: "2026-02-01 00:30" }),
        activity("overlap", "OUTDOOR", "2026-02-01 00:15", { endTime: "2026-02-01 00:45" }),
        activity("cross", "OUTDOOR", "2026-01-31 23:30", { endTime: "2026-02-01 00:30" }),
      ],
    });
    expect(outdoor(result, "2026-02-01")).toMatchObject({
      recordedMinutes: 45, recordCount: 2, value: { type: "number", value: 45 }, dataState: "known",
    });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate-activity-id" })]));
  });

  it("marks prior-day ongoing outdoor partial and ignores non-outdoor types", () => {
    const result = build({
      stats: [dailyStat("2026-02-01")],
      activities: [activity("ongoing", "OUTDOOR", "2026-01-31 23:50")],
    });
    expect(outdoor(result, "2026-02-01")).toMatchObject({ dataState: "partial", value: { type: "unknown" } });

    const longRunning = build({
      stats: [dailyStat("2026-02-01")],
      activities: [activity("long-running", "OUTDOOR", "2026-01-29 08:00")],
    });
    expect(outdoor(longRunning, "2026-02-01")).toMatchObject({
      recordedMinutes: 0, recordCount: 1, dataState: "partial", value: { type: "unknown" },
    });
    expect(longRunning.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid-outdoor" })]));

    const actualZero = build({ stats: [dailyStat("2026-02-01")] });
    expect(outdoor(actualZero, "2026-02-01")).toMatchObject({
      recordedMinutes: 0, recordCount: 0, dataState: "known", value: { type: "number", value: 0 },
    });

    const ignored = build({
      activities: [
        activity("head", "HEAD_LIFT", "2026-02-01 10:00", { endTime: "2026-02-01 10:20" }),
        activity("bath", "BATH", "2026-02-01 11:00", { endTime: "2026-02-01 11:20" }),
      ],
    });
    expect(outdoor(ignored, "2026-02-01")).toMatchObject({ recordedMinutes: null, dataState: "unknown" });
  });

  it("uses valid outdoor records even when a saved snapshot is absent", () => {
    const result = build({
      activities: [activity("out", "OUTDOOR", "2026-02-01 10:00", { endTime: "2026-02-01 10:20" })],
    });
    const cell = day(result, "2026-02-01");
    expect(outdoor(result, "2026-02-01").value).toEqual({ type: "number", value: 20 });
    expect(cell).toMatchObject({ hasSavedStat: false, dataState: "partial" });
  });
});

describe("care preferences", () => {
  const memoryStorage = (): CarePreferencesStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      get: (key) => data.get(key),
      set: (key, value) => void data.set(key, value),
      remove: (key) => void data.delete(key),
    };
  };

  it("validates finite positive custom ranges with friendly bounds", () => {
    const invalid = validateCarePreferences({
      ...DEFAULT_CARE_PREFERENCES,
      milkReference: { min: -1, max: 3000 },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues.some(({ message }) => message.includes("1–3000"))).toBe(true);

    const legacyCalibrated = validateCarePreferences({
      breastfeedRate: { mode: "calibrated", range: { min: 7, max: 12 }, source: "user-calibrated" },
      milkReference: null,
      sleepReference: null,
    });
    expect(legacyCalibrated).toEqual({
      ok: true,
      value: {
        breastfeedRate: { mode: "custom", range: { min: 7, max: 12 }, source: "user-custom" },
        milkReference: null,
        sleepReference: null,
      },
    });
  });

  it("scopes keys by backend origin and encoded baby, recovers corrupt values, and reports storage failures", () => {
    expect(carePreferencesStorageKey({ backendOrigin: "https://api.example.com/", babyId: "宝宝/一" }))
      .toBe(`bubu-care-preferences:https://api.example.com:${encodeURIComponent("宝宝/一")}`);

    const storage = memoryStorage();
    storage.data.set("bubu-care-preferences:https://api.example.com:baby", "{bad");
    expect(getCarePreferences({ backendOrigin: "https://api.example.com", babyId: "baby" }, storage))
      .toMatchObject({ storageState: "corrupt", preferences: DEFAULT_CARE_PREFERENCES });

    const failing: CarePreferencesStorage = {
      get: () => { throw new Error("read failed"); },
      set: () => { throw new Error("write failed"); },
      remove: () => undefined,
    };
    const scope = { backendOrigin: "https://api.example.com", babyId: "baby" };
    expect(() => getCarePreferences(scope, failing)).toThrow(CarePreferencesStorageFailure);
    expect(() => saveCarePreferences(scope, DEFAULT_CARE_PREFERENCES, failing)).toThrow(CarePreferencesStorageFailure);
  });

});
