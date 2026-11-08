import { describe, expect, it } from "vitest";
import {
  activityDetails, activityGaps, activityLabel, addDays, buildHeatmap, buildTrendRows, buildWeek, calendarPeriod,
  currentTimePosition, dateKey, dateRange, dayBounds, dayTitle, durationInDay, filterActivities,
  getIntensity, layoutDayTimeline, mondayOfWeek, monthBounds, monthTitle, millisecondsUntilNextShanghaiDay, previousEvening, shiftMonth,
  sortActivities, statCards, stepPeriod, summarizeHomeDay, summarizeRecordList, timeLabel, timeSinceLatest,
  weekBlockLabel, weekBlockLabelParts, weekTitle,
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

  it("keeps Shanghai dates advancing across a device daylight-saving change", () => {
    expect(dateKey("2026-10-04")).toBe("2026-10-04");
    expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
    expect(dateRange("2026-09-24", "2026-10-23")).toHaveLength(30);
    expect(dayBounds("2026-10-04")).toEqual({
      start: Date.parse("2026-10-03T16:00:00Z"),
      end: Date.parse("2026-10-04T15:59:59.999Z"),
      next: Date.parse("2026-10-04T16:00:00Z"),
    });
  });

  it("schedules the relative-title refresh at the next Shanghai midnight", () => {
    expect(millisecondsUntilNextShanghaiDay("2026-10-23T23:59:00+08:00")).toBe(60_000);
    expect(millisecondsUntilNextShanghaiDay("2026-10-23T00:00:00+08:00")).toBe(86_400_000);
  });

  it("uses today/yesterday/前日 labels at Shanghai midnight boundaries", () => {
    const now = "2026-10-23T13:00:00+08:00";
    expect(dayTitle("2026-10-22T16:30:00Z", now)).toBe("今日（周五）");
    expect(dayTitle("2026-10-22", now)).toBe("昨日（周四）");
    expect(dayTitle("2026-10-21", now)).toBe("前日（周三）");
    expect(dayTitle("2026-10-20", now)).toBe("10月20日（周二）");
    expect(dayTitle("2026-10-23T16:30:00Z", now)).toBe("10月24日（周六）");
  });

  it("builds relative week and month titles, including year rollover", () => {
    const now = "2026-10-23T13:00:00+08:00";
    expect(weekTitle("2026-10-23", now)).toBe("本周（10/19–）");
    expect(weekTitle("2026-10-18", now)).toBe("上周（10/12–10/18）");
    expect(weekTitle("2026-10-11", now)).toBe("10/5–10/11");
    expect(weekTitle("2025-12-31", "2026-02-01")).toBe("12/29–1/4");
    expect(weekTitle("2026-01-01", "2026-01-01")).toBe("本周（12/29–）");
    expect(weekTitle("2025-12-25", "2026-01-01")).toBe("上周（12/22–12/28）");
    expect(weekTitle("2025-12-18", "2026-01-01")).toBe("12/15–12/21");
    expect(calendarPeriod("week", "2025-12-31", "2026-02-01")).toMatchObject({
      start: "2025-12-29", end: "2026-01-04", title: "12/29–1/4",
    });
    expect(calendarPeriod("week", "2026-01-01", "2026-01-01")).toMatchObject({
      start: "2025-12-29", end: "2026-01-04", title: "本周（12/29–）", canNext: false,
    });

    expect(monthTitle("2026-10-01", now)).toBe("本月（10月）");
    expect(monthTitle("2026-09-30", now)).toBe("上月（9月）");
    expect(monthTitle("2026-08-01", now)).toBe("8月");
    expect(monthTitle("2025-12-31", now)).toBe("2025年12月");
    expect(monthBounds("2026-02-15")).toMatchObject({ year: 2026, month: 2, first: "2026-02-01", last: "2026-02-28", days: 28 });
    expect(monthBounds("2024-02-15")).toMatchObject({ first: "2024-02-01", last: "2024-02-29", days: 29 });
  });

  it("clamps calendar-month steps and never navigates into a future month", () => {
    const now = "2026-10-23T13:00:00+08:00";
    expect(shiftMonth("2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftMonth("2024-03-31", -1)).toBe("2024-02-29");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-31");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-15");
    expect(stepPeriod("month", "2026-09-30", 1, now)).toBe("2026-10-23");
    expect(stepPeriod("month", "2026-10-15", 1, now)).toBe("2026-10-15");
    expect(calendarPeriod("month", "2026-09-15", now)).toMatchObject({ start: "2026-09-01", end: "2026-09-30", canNext: true });
    expect(calendarPeriod("month", "2026-10-15", now).canNext).toBe(false);
    expect(calendarPeriod("month", "2025-12-15", now)).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
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
  it("clips cross-day blocks and keeps sleep/outdoor as full-width background bands", () => {
    const layout = layoutDayTimeline([
      event("night", "SLEEP", "2026-01-01 23:00", { endTime: "2026-01-02 07:00" }),
      event("outdoor", "OUTDOOR", "2026-01-02 06:00", { endTime: "2026-01-02 08:00" }),
      event("diaper", "DIAPER", "2026-01-02 06:10"),
      event("milk", "BOTTLE", "2026-01-02 06:20", { milkAmount: 90 }),
    ], "2026-01-02");
    expect(layout.find((item) => item.activity.id === "night")).toMatchObject({ top: 0, height: 420, left: 0, width: 100, isBackground: true });
    expect(layout.find((item) => item.activity.id === "outdoor")).toMatchObject({ isBackground: true, left: 0, width: 100 });
    expect(layout.find((item) => item.activity.id === "diaper")).toMatchObject({ isLine: true, isBackground: false, height: 2, width: 100 });
    expect(layout.find((item) => item.activity.id === "milk")).toMatchObject({ height: 15, duration: 5, left: 0, width: 100 });
  });

  it("does not let sleep/outdoor backgrounds take a foreground lane", () => {
    const layout = layoutDayTimeline([
      event("sleep", "SLEEP", "2026-01-02 08:00", { endTime: "2026-01-02 10:00" }),
      event("outdoor", "OUTDOOR", "2026-01-02 08:00", { endTime: "2026-01-02 10:00" }),
      event("pump", "PUMP", "2026-01-02 09:00", { endTime: "2026-01-02 09:20", milkAmount: 80 }),
    ], "2026-01-02");
    expect(layout.find((item) => item.activity.id === "pump")).toMatchObject({ left: 0, width: 100, lanes: 1, isBackground: false });
  });

  it("lays out genuinely overlapping foreground events in readable lanes", () => {
    const layout = layoutDayTimeline([
      event("sleep", "SLEEP", "2026-01-02 08:00", { endTime: "2026-01-02 10:00" }),
      event("pump", "PUMP", "2026-01-02 09:00", { endTime: "2026-01-02 09:20" }),
      event("milk", "BOTTLE", "2026-01-02 09:05", { milkAmount: 90 }),
    ], "2026-01-02");
    const pump = layout.find((item) => item.activity.id === "pump")!;
    const milk = layout.find((item) => item.activity.id === "milk")!;
    expect([pump.left, milk.left].sort((a, b) => a - b)).toEqual([0, 50]);
    expect([pump.width, milk.width]).toEqual([50, 50]);
    expect([pump.lanes, milk.lanes]).toEqual([2, 2]);
  });
  it("reserves the visual minimum when deciding foreground day lanes", () => {
    const layout = layoutDayTimeline([
      event("head", "HEAD_LIFT", "2026-01-02 10:00", { endTime: "2026-01-02 10:01" }),
      event("exercise", "PASSIVE_EXERCISE", "2026-01-02 10:20", { endTime: "2026-01-02 10:21" }),
    ], "2026-01-02", { minBlockHeightMinutes: 31 });
    const head = layout.find((item) => item.activity.id === "head")!;
    const exercise = layout.find((item) => item.activity.id === "exercise")!;
    expect(head.height).toBe(31);
    expect(exercise.height).toBe(31);
    expect([head.lanes, exercise.lanes]).toEqual([2, 2]);
    expect([head.width, exercise.width]).toEqual([50, 50]);
  });

  it("does not draw old unfinished or boundary-ended records outside the requested day", () => {
    expect(layoutDayTimeline([
      event("old", "SLEEP", "2026-01-01 20:00"),
      event("ended", "SLEEP", "2026-01-01 22:00", { endTime: "2026-01-02 00:00" }),
      event("next", "DIAPER", "2026-01-03 00:00"),
    ], "2026-01-02")).toEqual([]);
  });
  it("keeps the interval to the previous sleep on the later background band", () => {
    const layout = layoutDayTimeline([
      event("first", "SLEEP", "2026-01-02 08:00", { endTime: "2026-01-02 09:00" }),
      event("second", "SLEEP", "2026-01-02 12:30", { endTime: "2026-01-02 14:00" }),
    ], "2026-01-02");
    const first = layout.find((item) => item.activity.id === "first")!;
    const second = layout.find((item) => item.activity.id === "second")!;
    expect(first).toMatchObject({ isBackground: true, left: 0, width: 100 });
    expect(first.gapMinutes).toBeUndefined();
    expect(second).toMatchObject({ isBackground: true, left: 0, width: 100, gapMinutes: 210 });
  });

  it("uses the true clipped height for completed bands and clamps any minimum at 24:00", () => {
    const layout = layoutDayTimeline([
      event("nap", "SLEEP", "2026-01-02 12:00", { endTime: "2026-01-02 12:05" }),
      event("late", "OUTDOOR", "2026-01-02 23:55", { endTime: "2026-01-03 00:30" }),
      event("ongoing", "SLEEP", "2026-01-02 23:50"),
    ], "2026-01-02");
    expect(layout.find((item) => item.activity.id === "nap")).toMatchObject({ top: 720, height: 5, duration: 5 });
    expect(layout.find((item) => item.activity.id === "late")).toMatchObject({ top: 1435, height: 5 });
    // Unfinished records keep the legacy minimum, clamped so nothing passes 24:00.
    const ongoing = layout.find((item) => item.activity.id === "ongoing")!;
    expect(ongoing).toMatchObject({ top: 1430, height: 10 });
    expect(ongoing.top + ongoing.height).toBeLessThanOrEqual(1440);
    // The week column reports the same clipped segment as its measurement.
    const week = buildWeek([
      event("late", "OUTDOOR", "2026-01-05 23:55", { endTime: "2026-01-06 00:30" }),
    ], "2026-01-05", undefined, "2026-01-06");
    expect(week[0]?.blocks).toHaveLength(1);
    expect(week[0]?.blocks[0]).toMatchObject({ minutes: 5, isBackground: true });
  });

  it("keeps a late foreground block readable by moving only its visual top before 24:00", () => {
    const layout = layoutDayTimeline([
      event("late-pump", "PUMP", "2026-01-02 23:59", { endTime: "2026-01-03 00:04", milkAmount: 80 }),
      event("late-milk", "BOTTLE", "2026-01-02 23:59", { milkAmount: 90 }),
    ], "2026-01-02", { minBlockHeightMinutes: 30 });
    const pump = layout.find((item) => item.activity.id === "late-pump")!;
    const milk = layout.find((item) => item.activity.id === "late-milk")!;
    for (const block of [pump, milk]) {
      expect(block.height).toBe(30);
      expect(block.top + block.height).toBeLessThanOrEqual(1440);
      expect(block.isBackground).toBe(false);
    }
    // The stored start times are untouched; only the visual placement moved.
    expect(pump.activity.startTime).toBe("2026-01-02 23:59");
    expect(milk.activity.startTime).toBe("2026-01-02 23:59");
    // Lane collision reserves the final visual position and height.
    expect([pump.top, milk.top]).toEqual([1410, 1410]);
    expect([pump.lanes, milk.lanes]).toEqual([2, 2]);
    expect([pump.width, milk.width]).toEqual([50, 50]);
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
    const sleep = week[0]?.blocks.find((block) => block.activity.id === "sleep");
    expect(sleep).toMatchObject({ height: 7 / 24 * 100, minutes: 420, label: "7h", isBackground: true, left: 0, width: 100 });
    expect(week[0]?.blocks.find((block) => block.activity.id === "midnight")).toMatchObject({ top: 0, height: 1.5 });
    expect(week[0]?.blocks.find((block) => block.activity.id === "midnight")?.label).toBe("换尿布");
    expect(week[1]?.isToday).toBe(true);
    expect(week[2]?.isFuture).toBe(true);
  });

  it("labels a cross-midnight sleep with its clipped per-day segment and keeps backgrounds lane-free", () => {
    const week = buildWeek([
      event("sleep", "SLEEP", "2026-01-05 23:00", { endTime: "2026-01-06 07:00" }),
      event("pump", "PUMP", "2026-01-06 02:00", { endTime: "2026-01-06 02:20", milkAmount: 80 }),
    ], "2026-01-05", undefined, "2026-01-06");
    expect(week[0]?.blocks.find((block) => block.activity.id === "sleep")).toMatchObject({ minutes: 60, label: "1h", isBackground: true, lanes: 1 });
    expect(week[1]?.blocks.find((block) => block.activity.id === "sleep")).toMatchObject({ minutes: 420, label: "7h", isBackground: true, lanes: 1 });
    expect(week[1]?.blocks.find((block) => block.activity.id === "pump")).toMatchObject({ label: "80ml", left: 0, width: 100, lanes: 1 });
  });

  it("keeps the numeric measurement instead of losing it to a type-name prefix", () => {
    const bottle = weekBlockLabel(event("bottle", "BOTTLE", "2026-01-05 08:00", { milkAmount: 120 }));
    const sleep = weekBlockLabel(event("sleep", "SLEEP", "2026-01-05 08:00", { endTime: "2026-01-06 03:00" }), 420);
    const head = weekBlockLabel(event("head", "HEAD_LIFT", "2026-01-05 08:00", { endTime: "2026-01-05 08:10" }), 10);
    const roll = weekBlockLabel(event("roll", "ROLL_OVER", "2026-01-05 08:00", { count: 3 }));
    expect(bottle).toBe("120ml");
    expect(bottle).not.toContain("瓶喂");
    expect(sleep).toBe("7h");
    expect(sleep).not.toContain("睡眠");
    expect(head).toBe("10m");
    expect(head).not.toContain("抬头");
    expect(roll).toBe("3次");
    expect(roll).not.toContain("翻身");
  });

  it("uses the measured minimum height in week lane collisions", () => {
    const week = buildWeek([
      event("head", "HEAD_LIFT", "2026-01-05 10:00"),
      event("exercise", "PASSIVE_EXERCISE", "2026-01-05 10:30"),
    ], "2026-01-05", undefined, "2026-01-06", { minBlockHeightPercent: 3 });
    const head = week[0]!.blocks.find((block) => block.activity.id === "head")!;
    const exercise = week[0]!.blocks.find((block) => block.activity.id === "exercise")!;
    expect(head.height).toBe(3);
    expect(exercise.height).toBe(3);
    expect([head.lanes, exercise.lanes]).toEqual([2, 2]);
    expect([head.width, exercise.width]).toEqual([50, 50]);
  });

  it("gives measurement lanes more room than text-only lanes in a dense week overlap", () => {
    const week = buildWeek([
      event("milk", "BOTTLE", "2026-01-05 08:30", { endTime: "2026-01-05 09:00", milkAmount: 120 }),
      event("pump", "PUMP", "2026-01-05 08:32", { endTime: "2026-01-05 08:45", milkAmount: 80 }),
      event("diaper", "DIAPER", "2026-01-05 08:33", { hasPee: true }),
    ], "2026-01-05", undefined, "2026-01-06", { minBlockHeightPercent: 3 });
    const blocks = week[0]!.blocks.filter((block) => !block.isBackground);
    const milk = blocks.find((block) => block.activity.id === "milk")!;
    const pump = blocks.find((block) => block.activity.id === "pump")!;
    const diaper = blocks.find((block) => block.activity.id === "diaper")!;
    expect([milk.lane, pump.lane, diaper.lane]).toEqual([0, 1, 2]);
    expect(milk.width).toBeGreaterThan(pump.width);
    expect(pump.width).toBeGreaterThan(diaper.width);
    expect(milk.width + pump.width + diaper.width).toBeCloseTo(100, 5);
    expect(milk.label).toBe("120ml");
    expect(pump.label).toBe("80ml");
  });

  it("shows recorded week measurements without start clocks", () => {
    expect(weekBlockLabel(event("bottle", "BOTTLE", "2026-01-05 08:00", { milkAmount: 120, endTime: "2026-01-05 08:15" }))).toBe("120ml");
    expect(weekBlockLabel(event("bottle-zero", "BOTTLE", "2026-01-05 08:00", { milkAmount: 0 }))).toBe("0ml");
    expect(weekBlockLabel(event("bottle-unknown", "BOTTLE", "2026-01-05 08:00"))).toBe("瓶喂");
    expect(weekBlockLabel(event("pump", "PUMP", "2026-01-05 08:00", { milkAmount: 80 }))).toBe("80ml");
    expect(weekBlockLabel(event("feed", "BREASTFEED", "2026-01-05 08:00", { endTime: "2026-01-05 08:20" }), 20)).toBe("20m");
    expect(weekBlockLabel(event("sleep-zero", "SLEEP", "2026-01-05 08:00", { endTime: "2026-01-05 08:00" }), 0)).toBe("0m");
    expect(weekBlockLabel(event("sleep-unknown", "SLEEP", "2026-01-05 08:00"))).toBe("睡眠");
    expect(weekBlockLabel(event("roll-zero", "ROLL_OVER", "2026-01-05 08:00", { count: 0 }))).toBe("0次");
    expect(weekBlockLabel(event("roll-unknown", "ROLL_OVER", "2026-01-05 08:00"))).toBe("翻身");
    expect(weekBlockLabel(event("diaper", "DIAPER", "2026-01-05 08:00", { hasPee: true, hasPoop: true }))).toBe("大小便");
    expect(weekBlockLabel(event("supplement", "SUPPLEMENT", "2026-01-05 08:00", { supplementType: "AD" }))).toBe("AD");
    expect(weekBlockLabel(event("spit", "SPIT_UP", "2026-01-05 08:00", { spitUpType: "PROJECTILE" }))).toBe("喷射性吐奶");
    expect(weekBlockLabel(event("spit-unknown", "SPIT_UP", "2026-01-05 08:00"))).toBe("吐奶");
    expect(weekBlockLabel(event("head", "HEAD_LIFT", "2026-01-05 08:00", { endTime: "2026-01-05 08:10" }), 10)).toBe("10m");
  });
  it("splits compact measurements into a number and unit without changing either", () => {
    expect(weekBlockLabelParts("120ml")).toEqual({ value: "120", unit: "ml" });
    expect(weekBlockLabelParts("80ml")).toEqual({ value: "80", unit: "ml" });
    expect(weekBlockLabelParts("7h")).toEqual({ value: "7", unit: "h" });
    expect(weekBlockLabelParts("10m")).toEqual({ value: "10", unit: "m" });
    expect(weekBlockLabelParts("3次")).toEqual({ value: "3", unit: "次" });
    expect(weekBlockLabelParts("换尿布")).toBeNull();
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
  it("builds a natural calendar-month heatmap with neutral padding and local maxima", () => {
    const map = buildHeatmap([
      stat("2026-01-05", { totalSleepMinutes: 720, totalMilkAmount: 600 }),
      stat("2026-01-06", { totalSleepMinutes: 180, totalMilkAmount: 150 }),
      stat("2026-01-02", { totalSleepMinutes: 0, totalMilkAmount: 0 }),
      stat("2025-12-31", { totalSleepMinutes: 9999, totalMilkAmount: 9999 }),
      stat("2025-01-01", { totalSleepMinutes: 9999, totalMilkAmount: 9999 }),
      stat("2026-01-08", { totalSleepMinutes: 5000, totalMilkAmount: 5000 }),
    ], "2026-01-07", "2026-01-07");
    const days = map.weeks.flatMap((week) => week.days);
    expect(map).toMatchObject({ year: 2026, month: 1, maxSleep: 720, maxMilk: 600 });
    expect(map.weeks[0]?.start).toBe("2025-12-29");
    expect(map.weeks[4]?.days[6]?.date).toBe("2026-02-01");
    expect(days.filter((day) => day.inMonth)).toHaveLength(31);
    expect(days.find((day) => day.date === "2025-12-31")).toMatchObject({ inMonth: false, isPadding: true, hasData: false, sleepIntensity: 0 });
    expect(days.find((day) => day.date === "2026-01-02")).toMatchObject({ hasData: true, sleep: 0, sleepIntensity: 0 });
    expect(days.find((day) => day.date === "2026-01-03")).toMatchObject({ hasData: false, sleep: 0, sleepIntensity: 0 });
    expect(days.find((day) => day.date === "2026-01-06")?.sleepIntensity).toBe(2);
    expect(days.find((day) => day.date === "2026-01-08")).toMatchObject({ isFuture: true, hasData: false });
    expect([0, 24, 25, 50, 75, 100].map((n) => getIntensity(n, 100))).toEqual([0, 1, 2, 3, 4, 4]);
    expect(buildHeatmap([], "2026-01-07", "2026-01-07")).toMatchObject({ maxSleep: 720, maxMilk: 600 });
  });

  it("produces four, five and six week month grids with leap/year boundaries", () => {
    expect(buildHeatmap([], "2021-02-10", "2021-02-10").weeks).toHaveLength(4);
    expect(buildHeatmap([], "2026-02-10", "2026-02-10").weeks).toHaveLength(5);
    expect(buildHeatmap([], "2026-08-10", "2026-08-10").weeks).toHaveLength(6);
    const leap = buildHeatmap([], "2024-02-10", "2024-02-10");
    expect(leap.weeks.flatMap((week) => week.days).filter((day) => day.inMonth)).toHaveLength(29);
    expect(leap.weeks[0]?.start).toBe("2024-01-29");
    const rollover = buildHeatmap([], "2027-01-15", "2027-01-15");
    expect(rollover.weeks[0]?.start).toBe("2026-12-28");
    expect(rollover.weeks[0]?.days[0]).toMatchObject({ inMonth: false, isPadding: true });
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

  it("keeps explicit zero milk in details and treats null/undefined as unknown", () => {
    expect(activityDetails(event("zero", "BOTTLE", "2026-01-02 08:00", { milkAmount: 0 })))
      .toContainEqual({ label: "奶量", value: "0 ml" });
    expect(activityDetails(event("null", "PUMP", "2026-01-02 08:00", { milkAmount: null })))
      .toContainEqual({ label: "奶量", value: "未记录奶量" });
    expect(activityDetails(event("unknown", "BOTTLE", "2026-01-02 08:00")))
      .toContainEqual({ label: "奶量", value: "未记录奶量" });
  });

  it("distinguishes known false diaper flags from unknown elimination details", () => {
    expect(activityDetails(event("clean", "DIAPER", "2026-01-02 08:00", { hasPoop: false, hasPee: false })))
      .toContainEqual({ label: "尿布", value: "只换尿布" });
    expect(activityDetails(event("unknown-pooh", "DIAPER", "2026-01-02 08:00", { hasPoop: null, hasPee: false })))
      .toContainEqual({ label: "尿布", value: "未记录大小便情况" });
    expect(activityDetails(event("unknown-both", "DIAPER", "2026-01-02 08:00")))
      .toContainEqual({ label: "尿布", value: "未记录大小便情况" });

    const positive = activityDetails(event("positive", "DIAPER", "2026-01-02 08:00", {
      hasPoop: true, hasPee: null, poopColor: "YELLOW",
    }));
    expect(positive).toContainEqual({ label: "大便", value: "黄色" });
    expect(positive.some((field) => field.label === "尿布")).toBe(false);
  });

  it("preserves explicit zero counts and unknown count fields", () => {
    expect(activityDetails(event("zero-roll", "ROLL_OVER", "2026-01-02 08:00", { count: 0 })))
      .toContainEqual({ label: "次数", value: "0 次" });
    expect(activityDetails(event("zero-sit", "PULL_TO_SIT", "2026-01-02 08:00", { count: 0 })))
      .toContainEqual({ label: "次数", value: "0 次" });
    expect(activityDetails(event("null-roll", "ROLL_OVER", "2026-01-02 08:00", { count: null })))
      .toContainEqual({ label: "次数", value: "未记录次数" });
    expect(activityDetails(event("unknown-sit", "PULL_TO_SIT", "2026-01-02 08:00")))
      .toContainEqual({ label: "次数", value: "未记录次数" });
  });

  it("keeps zero milk and unknown spit-up labels explicit", () => {
    expect(activityLabel(event("zero-bottle", "BOTTLE", "2026-01-02 08:00", { milkAmount: 0 }))).toBe("瓶喂 0ml");
    expect(activityLabel(event("zero-pump", "PUMP", "2026-01-02 08:00", { milkAmount: 0 }))).toBe("吸奶 0ml");
    expect(activityLabel(event("spit-missing", "SPIT_UP", "2026-01-02 08:00"))).toBe("吐奶");
    expect(activityLabel(event("spit-null", "SPIT_UP", "2026-01-02 08:00", { spitUpType: null }))).toBe("吐奶");
    expect(activityLabel(event("spit-normal", "SPIT_UP", "2026-01-02 08:00", { spitUpType: "NORMAL" }))).toBe("普通吐奶");
    expect(activityLabel(event("spit-projectile", "SPIT_UP", "2026-01-02 08:00", { spitUpType: "PROJECTILE" }))).toBe("喷射性吐奶");
  });

  it("keeps creation and update metadata out of the core care fields", () => {
    const record = event("feed", "BREASTFEED", "2026-01-02 08:00", {
      notes: "记录备注", createdAt: "2026-01-02T00:01:00.000Z", updatedAt: "2026-01-02T00:02:00.000Z",
    });
    const labels = activityDetails(record).map((field) => field.label);
    expect(labels).not.toContain("记录时间");
    expect(labels).not.toContain("更新时间");
    expect(labels).toContain("备注");
  });
});
