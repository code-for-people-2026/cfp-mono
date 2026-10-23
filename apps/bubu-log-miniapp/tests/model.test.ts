import { describe, expect, it } from "vitest";
import {
  activityDetails, activityGaps, addDays, buildHeatmap, buildTrendRows, buildWeek, currentTimePosition,
  dateKey, durationInDay, filterActivities, getIntensity, layoutDayTimeline, mondayOfWeek,
  previousEvening, sortActivities, statCards, summarizeHomeDay, summarizeRecordList, timeLabel, timeSinceLatest,
  type Activity, type DailyStat,
} from "../src/model";

const event = (id: string, type: Activity["type"], start: string, extra: Partial<Activity> = {}): Activity => ({
  id, type, startTime: start, ...extra,
});
const stat = (date: string, extra: Partial<DailyStat> = {}): DailyStat => ({
  id: date, date, sleepCount: 0, totalSleepMinutes: 0, totalMilkAmount: 0, totalPumpMilkAmount: 0, diaperCount: 0, ...extra,
});

describe("Shanghai calendar dates", () => {
  it("uses China dates for ISO instants and bare dates regardless of host timezone", () => {
    expect(dateKey("2026-01-01T16:30:00Z")).toBe("2026-01-02");
    expect(timeLabel("2026-01-01T16:30:00Z")).toBe("00:30");
    expect(timeLabel("2026-01-02 09:30")).toBe("09:30");
    expect(mondayOfWeek("2026-01-01")).toBe("2025-12-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("retains the old client integer-minute clipping instead of DailyStats rounding", () => {
    expect(durationInDay("2026-01-01T23:00:00+08:00", "2026-01-02T07:00:00+08:00", "2026-01-01")).toBe(59);
    expect(durationInDay("2026-01-01T23:00:00+08:00", "2026-01-02T07:00:00+08:00", "2026-01-02")).toBe(420);
    expect(durationInDay("2026-01-01T23:00:00+08:00", "2026-01-02T00:00:00+08:00", "2026-01-02")).toBe(0);
  });
});

describe("legacy summary policies", () => {
  const activities = [
    event("sleep", "SLEEP", "2026-01-01 23:00", { endTime: "2026-01-02 07:00" }),
    event("ongoing", "SLEEP", "2026-01-02 14:00"),
    event("milk", "BOTTLE", "2026-01-02 08:00", { milkAmount: 90 }),
    event("old-milk", "BOTTLE", "2026-01-01 23:55", { milkAmount: 60, endTime: "2026-01-02 00:05" }),
    event("feed", "BREASTFEED", "2026-01-02 23:50", { endTime: "2026-01-03 00:10" }),
    event("old-feed", "BREASTFEED", "2026-01-01 23:50", { endTime: "2026-01-02 00:10" }),
    event("roll", "ROLL_OVER", "2026-01-02 10:00", { count: 0 }),
  ];
  it("keeps home start-day filtering, clipped feeding, and zero-count fallback", () => {
    const home = summarizeHomeDay(activities, "2026-01-02");
    expect(home.sleepCount).toBe(1);
    expect(home.totalSleepMinutes).toBe(420);
    expect(home.totalBottleMilkAmount).toBe(90);
    expect(home.totalBreastfeedMinutes).toBe(9);
    expect(home.totalRollOverCount).toBe(1);
  });
  it("keeps the record-list summary distinct from home", () => {
    const list = summarizeRecordList(activities, "2026-01-02");
    expect(list.totalBottleMilkAmount).toBe(150);
    expect(list.totalBreastfeedMinutes).toBe(40);
    expect(list.totalRollOverCount).toBe(0);
  });
  it("retains diaper folding and never treats diaperCount as the urine card", () => {
    const diapers: Activity[] = [
      event("large", "DIAPER", "2026-01-02 01:00", { hasPee: true, peeAmount: "LARGE" }),
      event("small", "DIAPER", "2026-01-02 02:00", { hasPee: true, peeAmount: "SMALL" }),
      event("medium", "DIAPER", "2026-01-02 03:00", { hasPee: true, peeAmount: "MEDIUM" }),
      event("poop", "DIAPER", "2026-01-02 04:00", { hasPoop: true }),
    ];
    const summary = summarizeHomeDay(diapers, "2026-01-02");
    expect(summary.diaperCount).toBe(4);
    expect(statCards(summary).find((card) => card.key === "diaper")?.value).toBe("2 次");
    expect(statCards(summary)).toHaveLength(8);
  });
  it("filters by union, treats no filters as all, and sorts without mutating input", () => {
    expect(filterActivities(activities, ["bottle", "breastfeed"])).toHaveLength(4);
    expect(filterActivities(activities, [])).toEqual(activities);
    const original = [...activities];
    expect(sortActivities(activities)[0]?.id).toBe("feed");
    expect(activities).toEqual(original);
  });
});

describe("day timeline", () => {
  it("clips cross-day blocks, keeps point lines full width and outdoor on the right", () => {
    const layout = layoutDayTimeline([
      event("night", "SLEEP", "2026-01-01 23:00", { endTime: "2026-01-02 07:00" }),
      event("outdoor", "OUTDOOR", "2026-01-02 06:00", { endTime: "2026-01-02 08:00" }),
      event("diaper", "DIAPER", "2026-01-02 06:10"),
      event("milk", "BOTTLE", "2026-01-02 06:20", { milkAmount: 90 }),
    ], "2026-01-02");
    expect(layout[0]).toMatchObject({ top: 0, height: 420, left: 0, width: 100 });
    expect(layout.find((item) => item.activity.id === "outdoor")).toMatchObject({ left: 50, width: 48 });
    expect(layout.find((item) => item.activity.id === "diaper")).toMatchObject({ isLine: true, height: 2, width: 100 });
    expect(layout.find((item) => item.activity.id === "milk")).toMatchObject({ height: 15, duration: 5, left: 50 });
  });
  it("does not draw old unfinished or boundary-ended records outside the requested day", () => {
    expect(layoutDayTimeline([
      event("old", "SLEEP", "2026-01-01 20:00"),
      event("ended", "SLEEP", "2026-01-01 22:00", { endTime: "2026-01-02 00:00" }),
      event("next", "DIAPER", "2026-01-03 00:00"),
    ], "2026-01-02")).toEqual([]);
  });
  it("combines feeding types for gaps, excludes pumps and future endings", () => {
    const activities = [
      event("first", "BREASTFEED", "2026-01-02 08:00", { endTime: "2026-01-02 08:20" }),
      event("pump", "PUMP", "2026-01-02 08:30", { endTime: "2026-01-02 08:50" }),
      event("second", "BOTTLE", "2026-01-02 09:00", { endTime: "2026-01-02 09:15" }),
      event("future", "SLEEP", "2026-01-02 09:00", { endTime: "2026-01-02 12:00" }),
    ];
    expect(activityGaps(activities).get("second")).toBe(40);
    expect(timeSinceLatest(activities, "2026-01-02 10:00")).toEqual({ sleep: null, feed: 45 });
    expect(currentTimePosition("2026-01-02", "2026-01-02 10:00")).toBe(600);
    expect(currentTimePosition("2026-01-01", "2026-01-02 10:00")).toBeNull();
  });
  it("selects only the last prior-evening feeding and sleep, retaining the 18:00 exclusion", () => {
    const activities = [
      event("boundary", "BOTTLE", "2026-01-01 18:00"),
      event("first", "BOTTLE", "2026-01-01 20:00"),
      event("last", "BREASTFEED", "2026-01-01 23:00"),
      event("night", "SLEEP", "2026-01-01 23:30"),
      event("today", "BOTTLE", "2026-01-02 00:00"),
    ];
    expect(previousEvening(activities, "2026-01-02").feeding?.id).toBe("last");
    expect(previousEvening(activities, "2026-01-02").sleep?.id).toBe("night");
    expect(previousEvening([activities[0]!], "2026-01-02").feeding).toBeNull();
  });
});

describe("week and trend views", () => {
  it("splits a cross-week sleep, includes midnight point events, and retains old categories", () => {
    const week = buildWeek([
      event("sleep", "SLEEP", "2026-01-04 23:00", { endTime: "2026-01-05 07:00" }),
      event("midnight", "DIAPER", "2026-01-05 00:00", { endTime: "2026-01-05 00:00" }),
      event("supplement", "SUPPLEMENT", "2026-01-05 08:00"),
      event("roll", "ROLL_OVER", "2026-01-05 09:00"),
    ], "2026-01-05", undefined, "2026-01-06");
    expect(week).toHaveLength(7);
    expect(week[0]?.blocks).toHaveLength(2);
    expect(week[0]?.blocks.find((block) => block.activity.id === "sleep")?.height).toBeCloseTo(7 / 24 * 100);
    expect(week[0]?.blocks.find((block) => block.activity.id === "midnight")).toMatchObject({ top: 0, height: 0.5 });
    expect(week[1]?.isToday).toBe(true);
    expect(week[2]?.isFuture).toBe(true);
  });
  it("uses server statistics verbatim and distinguishes an absent day from a recorded zero", () => {
    const rows = buildTrendRows([
      stat("2026-01-01", { totalSleepMinutes: 60, diaperCount: 5 }),
      stat("2026-01-03"),
    ], 3, "2026-01-03");
    expect(rows[0]).toMatchObject({ sleep: 60, diapers: 5, hasData: true });
    expect(rows[1]).toMatchObject({ sleep: 0, diapers: 0, hasData: false });
    expect(rows[2]?.hasData).toBe(true);
  });
  it("builds rolling four-week heatmaps with local maxima and exact threshold behavior", () => {
    const map = buildHeatmap([
      stat("2026-01-05", { totalSleepMinutes: 720, totalMilkAmount: 600 }),
      stat("2026-01-06", { totalSleepMinutes: 180, totalMilkAmount: 150 }),
      stat("2025-01-01", { totalSleepMinutes: 9999, totalMilkAmount: 9999 }),
    ], "2026-01-07", 4, "2026-01-07");
    expect(map.weeks[0]?.start).toBe("2025-12-15");
    expect(map.weeks[3]?.days[6]?.date).toBe("2026-01-11");
    expect(map.maxSleep).toBe(720);
    expect(map.weeks[3]?.days[1]?.sleepIntensity).toBe(2);
    expect(map.weeks[3]?.days[3]?.isFuture).toBe(true);
    expect([0, 24, 25, 50, 75, 100].map((n) => getIntensity(n, 100))).toEqual([0, 1, 2, 3, 4, 4]);
    expect(buildHeatmap([], "2026-01-07")).toMatchObject({ maxSleep: 720, maxMilk: 600 });
  });
});

describe("read-only details", () => {
  it("preserves false burping and firmness, but does not turn unknown into failure", () => {
    const record = event("feed", "BREASTFEED", "2026-01-02 08:00", { breastFirmness: "ELASTIC", burpSuccess: false, notes: "记录备注" });
    expect(activityDetails(record)).toContainEqual({ label: "拍嗝", value: "未成功" });
    expect(activityDetails(record)).toContainEqual({ label: "喂后乳房硬度", value: "弹" });
    expect(activityDetails(record)).toContainEqual({ label: "备注", value: "记录备注" });
    expect(activityDetails(event("unknown", "BREASTFEED", record.startTime)).some((field) => field.label === "拍嗝")).toBe(false);
  });
});
