import { activityLabel, activityTone } from "./presentation";
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
  duration: number;
  label: string;
  color: string;
  gapMinutes?: number;
}
const lineTypes = new Set<ActivityType>(["DIAPER", "SUPPLEMENT", "SPIT_UP"]);

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

export function layoutDayTimeline(activities: readonly Activity[], date: DateInput): TimelineItem[] {
  const bounds = dayBounds(date);
  const gaps = activityGaps(activities);
  const items: TimelineItem[] = [];
  for (const activity of activities) {
    const start = timestamp(activity.startTime);
    const isLine = lineTypes.has(activity.type);
    const duration = activity.endTime ? durationMinutes(start, activity.endTime) : isLine ? 0 : 5;
    const end = activity.endTime ? timestamp(activity.endTime) : start + Math.max(duration, 1) * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // The server may return old unfinished records. Do not draw them outside this day.
    if (isLine || end === start) {
      if (start < bounds.start || start >= bounds.next) continue;
    } else if (start >= bounds.next || end <= bounds.start) continue;
    const top = Math.trunc((Math.max(start, bounds.start) - bounds.start) / 60000);
    const visualMinutes = Math.max(Math.trunc((Math.min(end, bounds.next) - Math.max(start, bounds.start)) / 60000), isLine ? 0 : 1);
    items.push({ activity, top, height: isLine ? 2 : Math.max(visualMinutes, 15), left: 0, width: 100,
      isLine, duration, label: activityLabel(activity), color: activityTone(activity.type).border,
      ...(gaps.has(activity.id) ? { gapMinutes: gaps.get(activity.id)! } : {}) });
  }
  items.sort((a, b) => a.top - b.top);
  const result: TimelineItem[] = [];
  for (const item of items) {
    if (!item.isLine) {
      const overlaps = result.some((other) => !other.isLine && other.activity.type !== "OUTDOOR" && item.top < other.top + other.height && item.top + item.height > other.top);
      if (item.activity.type === "OUTDOOR" || overlaps) { item.left = 50; item.width = 48; }
    }
    result.push(item);
  }
  return result;
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
  { key: "sleep", label: "睡眠", types: ["SLEEP"], color: "#83a8b9" },
  { key: "feeding", label: "喂奶", types: ["BREASTFEED", "BOTTLE", "PUMP"], color: "#d29c9a" },
  { key: "diaper", label: "换尿布", types: ["DIAPER"], color: "#c0aa6d" },
  { key: "exercise", label: "运动", types: ["HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION"], color: "#bd9d77" },
];
export interface WeekBlock { activity: Activity; top: number; height: number; color: string }
export interface WeekDay { date: string; isToday: boolean; isFuture: boolean; blocks: WeekBlock[] }
export function buildWeek(activities: readonly Activity[], weekStart: DateInput, filters: readonly WeeklyFilter[] = WEEKLY_FILTERS.map((f) => f.key), now: DateInput = new Date()): WeekDay[] {
  const today = todayKey(now);
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
      const top = startMinutes / 1440 * 100;
      const height = (endMinutes - startMinutes) / 1440 * 100;
      blocks.push({ activity, top, height: height > 0 ? height : 0.5, color: activityTone(activity.type).border });
    }
    blocks.sort((a, b) => a.top - b.top);
    return { date, isToday: date === today, isFuture: date > today, blocks };
  });
}

export function currentTimePosition(date: DateInput, now: DateInput = new Date()): number | null {
  return dateKey(date) === dateKey(now) ? (timestamp(now) - dayBounds(now).start) / 60000 : null;
}
