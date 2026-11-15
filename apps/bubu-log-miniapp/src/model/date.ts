import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import type { DateInput } from "./types";

dayjs.extend(utc);
export const TIMEZONE = "Asia/Shanghai";
const CHINA_OFFSET_MINUTES = 480;

/** Bare calendar dates/local timestamps are China time, ISO offsets remain instants. */
function instant(value: DateInput) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(value)) {
    const local = value.length === 10 ? `${value}T00:00:00` : value.replace(" ", "T");
    return dayjs.utc(`${local}+08:00`);
  }
  return dayjs.utc(value);
}

// Calendar fields use UTC arithmetic shifted by China's fixed offset. Dayjs.utcOffset
// internally converts through the device's local clock; a DST transition there can
// otherwise repeat a date forever. This shifted clock must never be used as an instant.
function calendarClock(value: DateInput) {
  return instant(value).add(CHINA_OFFSET_MINUTES, "minute");
}

export const dateKey = (value: DateInput): string => calendarClock(value).format("YYYY-MM-DD");
export const todayKey = (now: DateInput = new Date()): string => dateKey(now);
export const dateLabel = (value: DateInput): string => calendarClock(value).format("M月D日");
export const timeLabel = (value: DateInput): string => calendarClock(value).format("HH:mm");
export const dateTimeLabel = (value: DateInput): string => calendarClock(value).format("M月D日 HH:mm");
export const shortDateLabel = (value: DateInput): string => calendarClock(value).format("M/D");
export const weekdayLabel = (value: DateInput): string => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][calendarClock(value).day()]!;
export const addDays = (value: DateInput, days: number): string => calendarClock(value).add(days, "day").format("YYYY-MM-DD");
export function mondayOfWeek(value: DateInput): string {
  const day = calendarClock(value);
  return day.subtract((day.day() + 6) % 7, "day").format("YYYY-MM-DD");
}
export interface MonthBounds { year: number; month: number; first: string; last: string; days: number }
export function monthBounds(value: DateInput): MonthBounds {
  const clock = calendarClock(value);
  const days = clock.daysInMonth();
  return {
    year: clock.year(), month: clock.month() + 1, days,
    first: clock.date(1).format("YYYY-MM-DD"),
    last: clock.date(days).format("YYYY-MM-DD"),
  };
}
/** Moves one calendar month and clamps the day to the target month's last day. */
export function shiftMonth(value: DateInput, direction: number): string {
  const clock = calendarClock(value);
  const target = clock.date(1).add(direction, "month");
  return target.date(Math.min(clock.date(), target.daysInMonth())).format("YYYY-MM-DD");
}
/** The Shanghai day label used by the central title. */
export function dayTitle(value: DateInput, now: DateInput = new Date()): string {
  const key = dateKey(value);
  const today = todayKey(now);
  const weekday = weekdayLabel(value);
  if (key === today) return `今日（${weekday}）`;
  if (key === addDays(today, -1)) return `昨日（${weekday}）`;
  if (key === addDays(today, -2)) return `前日（${weekday}）`;
  return `${dateLabel(value)}（${weekday}）`;
}
/** The Monday-based label for the week containing value. */
export function weekTitle(value: DateInput, now: DateInput = new Date()): string {
  const start = mondayOfWeek(value);
  const end = addDays(start, 6);
  const range = `${shortDateLabel(start)}–${shortDateLabel(end)}`;
  const currentStart = mondayOfWeek(todayKey(now));
  // The current week is still open-ended: only its Monday start is shown.
  if (start === currentStart) return `本周（${shortDateLabel(start)}–）`;
  if (start === addDays(currentStart, -7)) return `上周（${range}）`;
  return range;
}
/** Relative month label; earlier same-year months drop the year. */
export function monthTitle(value: DateInput, now: DateInput = new Date()): string {
  const clock = calendarClock(value);
  const current = calendarClock(todayKey(now));
  const month = `${clock.month() + 1}月`;
  const distance = (current.year() - clock.year()) * 12 + current.month() - clock.month();
  if (distance === 0) return `本月（${month}）`;
  if (distance === 1) return `上月（${month}）`;
  return clock.year() === current.year() ? month : `${clock.year()}年${month}`;
}
export type PeriodMode = "day" | "week" | "month";
export interface CalendarPeriod {
  mode: PeriodMode;
  start: string;
  end: string;
  title: string;
  canNext: boolean;
}
/** One helper for navigation title, fetched bounds and the next-month/day limit. */
export function calendarPeriod(mode: PeriodMode, value: DateInput, now: DateInput = new Date()): CalendarPeriod {
  const today = todayKey(now);
  if (mode === "month") {
    const bounds = monthBounds(value);
    return { mode, start: bounds.first, end: bounds.last, title: monthTitle(value, now), canNext: bounds.first < `${today.slice(0, 7)}-01` };
  }
  if (mode === "week") {
    const start = mondayOfWeek(value);
    const end = addDays(start, 6);
    return { mode, start, end, title: weekTitle(value, now), canNext: start < mondayOfWeek(today) };
  }
  const key = dateKey(value);
  return { mode, start: key, end: key, title: dayTitle(value, now), canNext: key < today };
}
/** Steps a period without moving into the future; month steps clamp the day. */
export function stepPeriod(mode: PeriodMode, value: DateInput, direction: number, now: DateInput = new Date()): string {
  const today = todayKey(now);
  if (mode === "month") {
    const target = shiftMonth(value, direction);
    if (target <= today) return target;
    return target.slice(0, 7) === today.slice(0, 7) ? today : dateKey(value);
  }
  const distance = mode === "week" ? 7 : 1;
  const target = addDays(value, direction * distance);
  return target > today ? today : target;
}
export function dayBounds(value: DateInput): { start: number; end: number; next: number } {
  const start = calendarClock(value).startOf("day").valueOf() - CHINA_OFFSET_MINUTES * 60_000;
  return { start, end: start + 86_400_000 - 1, next: start + 86_400_000 };
}
/** Delay until the next Shanghai calendar day; used by the relative-title tick. */
export function millisecondsUntilNextShanghaiDay(now: DateInput = new Date()): number {
  return Math.max(1_000, dayBounds(now).next - timestamp(now));
}
export const timestamp = (value: DateInput): number => instant(value).valueOf();
export const durationMinutes = (start: DateInput, end: DateInput): number => Math.trunc((timestamp(end) - timestamp(start)) / 60_000);
/** Retains the web client's truncation at 23:59:59.999 (server DailyStats rounds). */
export function durationInDay(start: DateInput, end: DateInput, date: DateInput): number {
  const bounds = dayBounds(date);
  return Math.max(0, Math.trunc((Math.min(timestamp(end), bounds.end) - Math.max(timestamp(start), bounds.start)) / 60000));
}
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}小时${remainder}分钟` : `${hours}小时`;
}
export function compactDuration(minutes: number): string {
  if (!minutes) return "-";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? `${remainder}m` : ""}` : `${remainder}m`;
}
export function dateRange(start: DateInput, end: DateInput): string[] {
  const dates: string[] = [];
  const last = dateKey(end);
  for (let date = dateKey(start); date <= last; date = addDays(date, 1)) dates.push(date);
  return dates;
}
