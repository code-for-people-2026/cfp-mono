import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import type { DateInput } from "./types";

dayjs.extend(utc);
export const TIMEZONE = "Asia/Shanghai";
const CHINA_OFFSET_MINUTES = 480;

/** Bare calendar dates/local timestamps are China time, ISO offsets remain instants. */
export function chinaDate(value: DateInput) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(value)) {
    const local = value.length === 10 ? `${value}T00:00:00` : value.replace(" ", "T");
    return dayjs.utc(`${local}+08:00`).utcOffset(CHINA_OFFSET_MINUTES);
  }
  // Modern China time is fixed UTC+8. Avoid the timezone plugin's Intl dependency
  // because WeChat JavaScript runtimes do not all provide Intl.DateTimeFormat.
  return dayjs(value).utcOffset(CHINA_OFFSET_MINUTES);
}

export const dateKey = (value: DateInput): string => chinaDate(value).format("YYYY-MM-DD");
export const todayKey = (now: DateInput = new Date()): string => dateKey(now);
export const dateLabel = (value: DateInput): string => chinaDate(value).format("M月D日");
export const timeLabel = (value: DateInput): string => chinaDate(value).format("HH:mm");
export const dateTimeLabel = (value: DateInput): string => chinaDate(value).format("M月D日 HH:mm");
// Formatting a fixed-offset Dayjs object can inherit a host DST transition.
// Shift only this UTC display value; the input instant and permission decisions stay unchanged.
export const fullDateTimeLabel = (value: DateInput): string => dayjs.utc(chinaDate(value).valueOf()).add(CHINA_OFFSET_MINUTES, "minute").format("YYYY/MM/DD HH:mm");
export const shortDateLabel = (value: DateInput): string => chinaDate(value).format("M/D");
export const weekdayLabel = (value: DateInput): string => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][chinaDate(value).day()]!;
export const addDays = (value: DateInput, days: number): string => chinaDate(value).add(days, "day").format("YYYY-MM-DD");
export function mondayOfWeek(value: DateInput): string {
  const day = chinaDate(value);
  return day.subtract((day.day() + 6) % 7, "day").format("YYYY-MM-DD");
}
export function dayBounds(value: DateInput): { start: number; end: number; next: number } {
  const start = chinaDate(value).startOf("day");
  return { start: start.valueOf(), end: start.endOf("day").valueOf(), next: start.add(1, "day").valueOf() };
}
export const timestamp = (value: DateInput): number => chinaDate(value).valueOf();
export const durationMinutes = (start: DateInput, end: DateInput): number => chinaDate(end).diff(chinaDate(start), "minute");
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
