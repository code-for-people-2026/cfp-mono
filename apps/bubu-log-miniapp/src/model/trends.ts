import { addDays, dateKey, dateRange, mondayOfWeek, monthBounds, shortDateLabel, todayKey } from "./date";
import type { DailyStat, DateInput } from "./types";
import { coverageMessage, hasMetricFacts } from "./records";

export interface TrendRow { date: string; label: string; sleep: number; milk: number; pump: number; diapers: number; hasData: boolean; known?: Record<"sleep" | "milk" | "pump" | "diapers", boolean>; coverage?: string }
export function buildTrendRows(stats: readonly DailyStat[], days: number = 7, endDate: DateInput = new Date()): TrendRow[] {
  const byDate = new Map(stats.map((stat) => [dateKey(stat.date), stat]));
  return dateRange(addDays(endDate, 1 - days), endDate).map((date) => {
    const stat = byDate.get(date);
    return { date, label: shortDateLabel(date), sleep: stat?.totalSleepMinutes ?? 0, milk: stat?.totalMilkAmount ?? 0,
      pump: stat?.totalPumpMilkAmount ?? 0, diapers: stat?.diaperCount ?? 0, hasData: Boolean(stat),
      ...(stat?.byType ? { known: {
        sleep: !!hasMetricFacts(stat.byType, "sleep"), milk: !!hasMetricFacts(stat.byType, "milk"),
        pump: !!hasMetricFacts(stat.byType, "pump"), diapers: !!hasMetricFacts(stat.byType, "diapers"),
      } } : {}),
      ...(stat?.coverage ? { coverage: coverageMessage(stat.coverage) } : {}) };
  });
}
export type Intensity = 0 | 1 | 2 | 3 | 4;
export function getIntensity(value: number, max: number): Intensity {
  if (value === 0) return 0;
  const ratio = value / max;
  return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
}
export interface HeatmapDay {
  date: string;
  /** False for the neutral leading/trailing days that complete the month grid. */
  inMonth: boolean;
  isPadding: boolean;
  isToday: boolean;
  isFuture: boolean;
  hasData: boolean;
  sleep: number;
  milk: number;
  sleepIntensity: Intensity;
  milkIntensity: Intensity;
  known?: { sleep: boolean; milk: boolean };
  coverage?: string;
}
export interface HeatmapData {
  year: number;
  month: number;
  weeks: Array<{ start: string; days: HeatmapDay[] }>;
  maxSleep: number;
  maxMilk: number;
}
/**
 * A natural Shanghai calendar month grid (Monday first). Padding days are neutral and
 * future in-month days never expose or scale saved statistics.
 */
export function buildHeatmap(stats: readonly DailyStat[], monthDate: DateInput = new Date(), now: DateInput = new Date()): HeatmapData {
  const month = monthBounds(monthDate);
  const today = todayKey(now);
  const byDate = new Map(stats.map((stat) => [dateKey(stat.date), stat]));
  const relevant = stats.filter((stat) => {
    const date = dateKey(stat.date);
    return date >= month.first && date <= month.last && date <= today;
  });
  const maxSleep = Math.max(0, ...relevant.map((stat) => stat.totalSleepMinutes || 0)) || 720;
  const maxMilk = Math.max(0, ...relevant.map((stat) => stat.totalMilkAmount || 0)) || 600;
  const firstGridDate = mondayOfWeek(month.first);
  const lastGridDate = addDays(mondayOfWeek(month.last), 6);
  const dates = dateRange(firstGridDate, lastGridDate);
  const weeks: HeatmapData["weeks"] = [];
  for (let index = 0; index < dates.length; index += 7) {
    const start = dates[index]!;
    weeks.push({ start, days: dates.slice(index, index + 7).map((date) => {
      const inMonth = date >= month.first && date <= month.last;
      const isFuture = inMonth && date > today;
      const stat = inMonth && !isFuture ? byDate.get(date) : undefined;
      const sleep = stat?.totalSleepMinutes ?? 0;
      const milk = stat?.totalMilkAmount ?? 0;
      return {
        date, inMonth, isPadding: !inMonth, isToday: inMonth && date === today, isFuture,
        hasData: Boolean(stat), sleep, milk,
        sleepIntensity: stat ? getIntensity(sleep, maxSleep) : 0,
        milkIntensity: stat ? getIntensity(milk, maxMilk) : 0,
        ...(stat?.byType ? { known: { sleep: !!hasMetricFacts(stat.byType, "sleep"), milk: !!hasMetricFacts(stat.byType, "milk") } } : {}),
        ...(stat?.coverage ? { coverage: coverageMessage(stat.coverage) } : {}),
      };
    }) });
  }
  return { year: month.year, month: month.month, weeks, maxSleep, maxMilk };
}
