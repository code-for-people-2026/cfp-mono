import { activityCategoryTone, activityLabel, activityTone, weekBlockLabel, weekBlockLabelParts } from "./presentation";
import { addDays, dateKey, dayBounds, durationMinutes, timestamp, todayKey } from "./date";
import type { Activity, ActivityType, DateInput, WeeklyFilter } from "./types";

export const TIMELINE_HEIGHT = 1440;
export interface TimelineItem {
  activity: Activity;
  /** Logical pixels: 60 per hour. */
  top: number;
  height: number;
  /** Percentage of content width. */
  left: number;
  width: number;
  isLine: boolean;
  /** Full-width, non-interactive-lane sleep/outdoor band behind foreground events. */
  isBackground: boolean;
  lane: number;
  lanes: number;
  duration: number;
  label: string;
  color: string;
  gapMinutes?: number;
}
const lineTypes = new Set<ActivityType>(["DIAPER", "SUPPLEMENT", "SPIT_UP"]);
const backgroundTypes = new Set<ActivityType>(["SLEEP", "OUTDOOR"]);
export const isBackgroundActivity = (type: ActivityType): boolean => backgroundTypes.has(type);

interface LaneItem { top: number; height: number; lane: number; lanes: number }
/** Greedy interval lanes for foreground blocks; background bands never enter here. */
function assignLanes<T extends LaneItem>(items: readonly T[]): void {
  const ordered = [...items].sort((a, b) => a.top - b.top || b.height - a.height);
  let active: T[] = [];
  let group: T[] = [];
  const finish = () => {
    const lanes = Math.max(1, ...group.map((item) => item.lane + 1));
    for (const item of group) item.lanes = lanes;
    group = [];
  };
  for (const item of ordered) {
    active = active.filter((other) => other.top + other.height > item.top);
    if (!active.length && group.length) finish();
    const used = new Set(active.map((other) => other.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    item.lane = lane;
    active.push(item);
    group.push(item);
  }
  if (group.length) finish();
}

export function activityGaps(activities: readonly Activity[]): Map<string, number> {
  const gaps = new Map<string, number>();
  for (const types of [["SLEEP"], ["BREASTFEED", "BOTTLE"]]) {
    const ordered = activities.filter((a) => types.includes(a.type)).sort((a, b) => timestamp(a.startTime) - timestamp(b.startTime));
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      const gap = durationMinutes(previous.endTime || previous.startTime, current.startTime);
      if (gap > 0) gaps.set(current.id, gap);
    }
  }
  return gaps;
}

export interface DayLayoutOptions {
  /**
   * Minimum visual block height in minutes at the current zoom. Callers derive it
   * from the measured canvas so lane collisions use the same height the user sees.
   */
  minBlockHeightMinutes?: number;
}

export function layoutDayTimeline(activities: readonly Activity[], date: DateInput, options: DayLayoutOptions = {}): TimelineItem[] {
  const bounds = dayBounds(date);
  const gaps = activityGaps(activities);
  const minimumMinutes = Math.max(0, options.minBlockHeightMinutes ?? 15);
  const items: TimelineItem[] = [];
  for (const activity of activities) {
    const start = timestamp(activity.startTime);
    const isLine = lineTypes.has(activity.type);
    const isBackground = !isLine && backgroundTypes.has(activity.type);
    const duration = activity.endTime ? durationMinutes(start, activity.endTime) : isLine ? 0 : 5;
    const end = activity.endTime ? timestamp(activity.endTime) : start + Math.max(duration, 1) * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // The server may return old unfinished records. Do not draw them outside this day.
    if (isLine || end === start) {
      if (start < bounds.start || start >= bounds.next) continue;
    } else if (start >= bounds.next || end <= bounds.start) continue;
    const top = Math.trunc((Math.max(start, bounds.start) - bounds.start) / 60000);
    const visualMinutes = Math.max(Math.trunc((Math.min(end, bounds.next) - Math.max(start, bounds.start)) / 60000), isLine ? 0 : 1);
    // Completed sleep/outdoor bands keep their true clipped height, matching
    // buildWeek; unfinished background records keep the legacy minimum, clamped
    // so no band passes the 24:00 edge.
    const naturalHeight = isLine ? 2 : isBackground && activity.endTime ? visualMinutes : Math.max(visualMinutes, 15);
    // Foreground minimums are part of layout, so a readable block also reserves
    // the lane space it occupies. A foreground block never shrinks below its
    // readable height: like buildWeek, only its visual top moves up to fit
    // 00:00–24:00; the stored timestamps, labels and details are untouched.
    const height = isLine ? 2 : isBackground ? Math.min(naturalHeight, TIMELINE_HEIGHT - top) : Math.max(naturalHeight, minimumMinutes);
    items.push({ activity, top: isLine || isBackground ? top : Math.min(top, Math.max(0, TIMELINE_HEIGHT - height)), height, left: 0, width: 100,
      isLine, isBackground, lane: 0, lanes: 1,
      duration, label: activityLabel(activity), color: activityTone(activity.type).border,
      ...(gaps.has(activity.id) ? { gapMinutes: gaps.get(activity.id)! } : {}) });
  }
  items.sort((a, b) => a.top - b.top);
  assignLanes(items.filter((item) => !item.isLine && !item.isBackground));
  for (const item of items) {
    if (item.isBackground || item.isLine) continue;
    item.left = item.lane / item.lanes * 100;
    item.width = 100 / item.lanes;
  }
  return items;
}

export function timeSinceLatest(activities: readonly Activity[], now: DateInput = new Date()): { sleep: number | null; feed: number | null } {
  const current = timestamp(now);
  let sleep: number | null = null;
  let feed: number | null = null;
  for (const activity of activities) {
    const end = timestamp(activity.endTime || activity.startTime);
    if (end > current) continue;
    if (activity.type === "SLEEP" && (sleep === null || end > sleep)) sleep = end;
    if ((activity.type === "BREASTFEED" || activity.type === "BOTTLE") && (feed === null || end > feed)) feed = end;
  }
  return { sleep: sleep === null ? null : Math.trunc((current - sleep) / 60000), feed: feed === null ? null : Math.trunc((current - feed) / 60000) };
}

export function previousEvening(activities: readonly Activity[], date: DateInput): { feeding: Activity | null; sleep: Activity | null } {
  const end = dayBounds(date).start;
  const start = end - 6 * 3600000;
  const ordered = activities.filter((a) => timestamp(a.startTime) > start && timestamp(a.startTime) < end)
    .sort((a, b) => timestamp(b.startTime) - timestamp(a.startTime));
  return { feeding: ordered.find((a) => a.type === "BREASTFEED" || a.type === "BOTTLE") || null, sleep: ordered.find((a) => a.type === "SLEEP") || null };
}

export const WEEKLY_FILTERS: Array<{ key: WeeklyFilter; label: string; types: ActivityType[]; color: string }> = [
  { key: "sleep", label: "睡眠", types: ["SLEEP"], color: activityCategoryTone("sleep").color },
  { key: "feeding", label: "喂奶", types: ["BREASTFEED", "BOTTLE", "PUMP"], color: activityCategoryTone("milk").color },
  { key: "diaper", label: "换尿布", types: ["DIAPER"], color: activityCategoryTone("diaper").color },
  { key: "exercise", label: "运动", types: ["HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION"], color: activityTone("HEAD_LIFT").border },
];
export interface WeekBlock {
  activity: Activity;
  top: number;
  height: number;
  /** Percentage of the day column width. */
  left: number;
  width: number;
  color: string;
  label: string;
  /** Clipped minutes for this calendar day segment; undefined when unmeasured. */
  minutes?: number;
  isBackground: boolean;
  lane: number;
  lanes: number;
}
export interface WeekDay { date: string; isToday: boolean; isFuture: boolean; blocks: WeekBlock[] }
export interface WeekLayoutOptions {
  /**
   * Minimum visual block height as a percentage of the 24h canvas. The component
   * derives it from the measured canvas height and current zoom, so zooming out
   * cannot shrink a stacked number+unit label; lane collisions reserve this height.
   */
  minBlockHeightPercent?: number;
}
/**
 * Give measurement lanes a little more horizontal room than text-only lanes.
 * Values keep their digits and units; this only decides how much of the day column
 * each overlapping lane receives.
 */
function weekLaneWeight(label: string): number {
  const parts = weekBlockLabelParts(label);
  if (!parts) return 1;
  return 1 + Math.min(4, parts.value.length) * 0.12 + (parts.unit.length > 1 ? 0.05 : 0);
}
export function buildWeek(activities: readonly Activity[], weekStart: DateInput, filters: readonly WeeklyFilter[] = WEEKLY_FILTERS.map((f) => f.key), now: DateInput = new Date(), options: WeekLayoutOptions = {}): WeekDay[] {
  const today = todayKey(now);
  const minimumHeight = Math.max(0, options.minBlockHeightPercent ?? 1.5);
  const allowed = new Set(WEEKLY_FILTERS.filter((f) => filters.includes(f.key)).flatMap((f) => f.types));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const bounds = dayBounds(date);
    const blocks: WeekBlock[] = [];
    for (const activity of activities) {
      if (!allowed.has(activity.type)) continue;
      const start = timestamp(activity.startTime);
      const end = activity.endTime ? timestamp(activity.endTime) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const point = end === start;
      // Include midnight point events; the old strict intersection accidentally hid them.
      if (point ? start < bounds.start || start >= bounds.next : start >= bounds.next || end <= bounds.start) continue;
      const startMinutes = Math.floor((Math.max(start, bounds.start) - bounds.start) / 60000);
      const endMinutes = Math.floor((Math.min(end, bounds.next) - bounds.start) / 60000);
      const naturalTop = startMinutes / 1440 * 100;
      const naturalHeight = (endMinutes - startMinutes) / 1440 * 100;
      // A cross-midnight record is deliberately clipped per column; stored stats are untouched.
      const minutes = activity.endTime ? Math.max(0, endMinutes - startMinutes) : undefined;
      const isBackground = isBackgroundActivity(activity.type);
      const height = isBackground ? (naturalHeight > 0 ? naturalHeight : 1.5) : Math.max(naturalHeight > 0 ? naturalHeight : 1.5, minimumHeight);
      // Keep a readable minimum on-canvas instead of letting a late-night instant
      // block overflow the 24:00 edge. This is visual placement, not a timestamp change.
      const top = isBackground ? naturalTop : Math.min(naturalTop, Math.max(0, 100 - height));
      blocks.push({
        // Instant records still need one readable line; this is a visual minimum, not a duration.
        activity, top, height, left: 0, width: 100,
        color: activityTone(activity.type).border, label: weekBlockLabel(activity, minutes),
        ...(minutes === undefined ? {} : { minutes }),
        isBackground, lane: 0, lanes: 1,
      });
    }
    blocks.sort((a, b) => a.top - b.top);
    const foreground = blocks.filter((block) => !block.isBackground);
    assignLanes(foreground);
    const laneWeights: number[] = [];
    for (const block of foreground) {
      laneWeights[block.lane] = Math.max(laneWeights[block.lane] ?? 1, weekLaneWeight(block.label));
    }
    for (const block of foreground) {
      const weights = Array.from({ length: block.lanes }, (_, lane) => laneWeights[lane] ?? 1);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const before = weights.slice(0, block.lane).reduce((sum, weight) => sum + weight, 0);
      block.left = before / total * 100;
      block.width = (weights[block.lane] ?? 1) / total * 100;
    }
    return { date, isToday: date === today, isFuture: date > today, blocks };
  });
}

export function currentTimePosition(date: DateInput, now: DateInput = new Date()): number | null {
  return dateKey(date) === dateKey(now) ? (timestamp(now) - dayBounds(now).start) / 60000 : null;
}
