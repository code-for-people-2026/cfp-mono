import { addDays, dateKey, dateRange, mondayOfWeek, shortDateLabel, todayKey } from "./date";
import type { DailyStat, DateInput } from "./types";

export interface TrendRow { date: string; label: string; sleep: number; milk: number; pump: number; diapers: number; hasData: boolean }
export function buildTrendRows(stats: readonly DailyStat[], days: number = 7, endDate: DateInput = new Date()): TrendRow[] {
  const byDate = new Map(stats.map((stat) => [dateKey(stat.date), stat]));
  return dateRange(addDays(endDate, 1 - days), endDate).map((date) => {
    const stat = byDate.get(date);
    return { date, label: shortDateLabel(date), sleep: stat?.totalSleepMinutes ?? 0, milk: stat?.totalMilkAmount ?? 0,
      pump: stat?.totalPumpMilkAmount ?? 0, diapers: stat?.diaperCount ?? 0, hasData: Boolean(stat) };
  });
}
export type Intensity = 0 | 1 | 2 | 3 | 4;
export function getIntensity(value: number, max: number): Intensity {
  if (value === 0) return 0;
  const ratio = value / max;
  return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
}
export interface HeatmapDay { date: string; isToday: boolean; isFuture: boolean; hasData: boolean; sleep: number; milk: number; sleepIntensity: Intensity; milkIntensity: Intensity }
export interface HeatmapData { weeks: Array<{ start: string; days: HeatmapDay[] }>; maxSleep: number; maxMilk: number }
export function buildHeatmap(stats: readonly DailyStat[], endDate: DateInput = new Date(), weeks: number = 4, now: DateInput = new Date()): HeatmapData {
  const lastWeek = mondayOfWeek(endDate);
  const first = addDays(lastWeek, (1 - weeks) * 7);
  const last = addDays(lastWeek, 6);
  const relevant = stats.filter((s) => dateKey(s.date) >= first && dateKey(s.date) <= last);
  const maxSleep = Math.max(0, ...relevant.map((s) => s.totalSleepMinutes || 0)) || 720;
  const maxMilk = Math.max(0, ...relevant.map((s) => s.totalMilkAmount || 0)) || 600;
  const byDate = new Map(relevant.map((stat) => [dateKey(stat.date), stat]));
  const today = todayKey(now);
  return {
    maxSleep, maxMilk,
    weeks: Array.from({ length: weeks }, (_, index) => {
      const start = addDays(first, index * 7);
      return { start, days: Array.from({ length: 7 }, (_, day) => {
        const date = addDays(start, day);
        const stat = byDate.get(date);
        const sleep = stat?.totalSleepMinutes ?? 0;
        const milk = stat?.totalMilkAmount ?? 0;
        return { date, isToday: date === today, isFuture: date > today, hasData: Boolean(stat), sleep, milk,
          sleepIntensity: getIntensity(sleep, maxSleep), milkIntensity: getIntensity(milk, maxMilk) };
      }) };
    }),
  };
}
