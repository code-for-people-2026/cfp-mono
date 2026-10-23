import { z } from "zod";
import { hash } from "./persistence";
import { affectedDates, chinaDate, chinaDayRange, computeStatistics, emptyDailyMetrics } from "./statistics";
import { activityTypes, type LegacyActivity } from "./types";

const identifier = z.string().min(1);
const time = z.iso.datetime({ offset: true });
const optionalNumber = z.number().finite().nonnegative().nullish();
const activitySchema = z.object({
  id: identifier, babyId: identifier, type: z.enum(activityTypes), startTime: time, endTime: time.nullish(),
  milkAmount: optionalNumber, count: optionalNumber, hasPoop: z.boolean().nullish(), hasPee: z.boolean().nullish(),
  burpSuccess: z.boolean().nullish(), poopPhotoUrl: z.string().nullish(), notes: z.string().nullish(),
  milkSource: z.enum(["BREAST_MILK", "FORMULA"]).nullish(), breastFirmness: z.enum(["SOFT", "ELASTIC", "HARD"]).nullish(),
  poopColor: z.enum(["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"]).nullish(), peeAmount: z.enum(["SMALL", "MEDIUM", "LARGE"]).nullish(),
  supplementType: z.enum(["AD", "D3", "PROBIOTICS", "PREBIOTICS"]).nullish(), spitUpType: z.enum(["NORMAL", "PROJECTILE"]).nullish(),
}).passthrough();
const metricNames = Object.keys(emptyDailyMetrics());
const dailyStatSchema = z.object({ babyId: identifier, date: z.string().min(1),
  ...Object.fromEntries(metricNames.map(name => [name, z.number().finite().nonnegative().optional()])),
}).passthrough();
const snapshotSchema = z.object({ activities: z.array(activitySchema), dailyStats: z.array(dailyStatSchema).optional() }).strict();
export interface HistorySnapshot { activities: LegacyActivity[]; dailyStats?: Array<{ babyId: string; date: string; [field: string]: unknown }> }

/** Exported legacy facts only. No database, credentials, remote media, or sidecar mutation is used. */
export function parseHistorySnapshot(input: unknown): HistorySnapshot {
  const parsed = snapshotSchema.parse(input);
  const seen = new Set<string>();
  for (const row of parsed.activities) {
    if (seen.has(row.id)) throw new Error("Duplicate activity ID in history export");
    seen.add(row.id);
    if (row.endTime && Date.parse(row.endTime) < Date.parse(row.startTime)) throw new Error("Activity ends before it starts");
    affectedDates([row as LegacyActivity]);
  }
  const stats = new Set<string>();
  for (const row of parsed.dailyStats || []) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : chinaDate(row.date);
    chinaDayRange(date); row.date = date;
    const key = JSON.stringify([row.babyId, date]);
    if (stats.has(key)) throw new Error("Duplicate daily statistics in history export");
    stats.add(key);
  }
  return parsed as HistorySnapshot;
}

const durationTypes = new Set(["BREASTFEED", "BOTTLE", "PUMP", "SLEEP", "HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION"]);
const factFields = Object.keys(activitySchema.shape).filter(field => field !== "id" && field !== "babyId");
const factsFingerprint = (row: LegacyActivity) => hash(Object.fromEntries(factFields.map(field => {
  const value = (row as unknown as Record<string, unknown>)[field] ?? null;
  return [field, ["startTime", "endTime"].includes(field) && typeof value === "string" ? new Date(value).toISOString() : value];
})));
const photo = (row: LegacyActivity) => typeof row.poopPhotoUrl === "string" && row.poopPhotoUrl.length > 0;
function summarize(snapshot: HistorySnapshot, babyId: string) {
  const activities = snapshot.activities.filter(row => row.babyId === babyId);
  const saved = snapshot.dailyStats?.filter(row => row.babyId === babyId) || [];
  const dates = affectedDates(activities);
  const daily = [...new Set([...dates, ...saved.map(row => row.date)])].sort().map(date => {
    // Historical missing end times remain unknown; this audit never infers ongoing progress.
    const summary = computeStatistics(activities, date, [], chinaDayRange(date).end - 1);
    const startsToday = activities.filter(row => chinaDate(row.startTime) === date);
    const diapers = startsToday.filter(row => row.type === "DIAPER");
    const large = diapers.filter(row => row.hasPee && row.peeAmount === "LARGE").length;
    const smallMedium = diapers.filter(row => row.hasPee && ["SMALL", "MEDIUM"].includes(row.peeAmount || "")).length;
    const oldStat = saved.find(row => row.date === date);
    const savedMetricDifferences = oldStat ? metricNames.flatMap(metric => typeof oldStat[metric] === "number" && oldStat[metric] !== summary.metrics[metric]
      ? [{ metric, saved: oldStat[metric], recomputed: summary.metrics[metric]! }] : []) : [];
    return { date, metrics: summary.metrics, coverage: { ...summary.coverage,
      unknownDurations: Object.values(summary.byType).reduce((sum, value) => sum + value.unknownDurations, 0),
      unknownCounts: Object.values(summary.byType).reduce((sum, value) => sum + value.unknownCount, 0) },
      counts: { rollOver: summary.byType.ROLL_OVER!.knownCount, pullToSit: summary.byType.PULL_TO_SIT!.knownCount },
      legacyUiDifferences: {
        foldedUrineCard: large + Math.ceil(smallMedium / 2), actualDiapers: summary.metrics.diaperCount!, actualPee: summary.metrics.peeCount!,
        unknownMilkDisplayedAsZero: startsToday.filter(row => ["BOTTLE", "PUMP"].includes(row.type) && row.milkAmount == null).length,
        unknownDurationDisplayedAsZero: startsToday.filter(row => durationTypes.has(row.type) && !row.endTime).length,
        unknownCountDefaultedToOne: startsToday.filter(row => ["ROLL_OVER", "PULL_TO_SIT"].includes(row.type) && row.count == null).length,
        zeroCountDefaultedToOneOnHome: startsToday.filter(row => ["ROLL_OVER", "PULL_TO_SIT"].includes(row.type) && row.count === 0).length,
      }, savedStatisticsPresent: !!oldStat, savedMetricDifferences };
  });
  return { activities: activities.length, photos: activities.filter(photo).length, dates,
    firstDate: dates[0] || null, lastDate: dates.at(-1) || null,
    byType: activityTypes.map(type => { const rows = activities.filter(row => row.type === type); return { type, activities: rows.length, photos: rows.filter(photo).length, dates: affectedDates(rows) }; }), daily };
}

/** Compare original and mapped exports, or audit the mapping of a single export to current statistics. */
export function auditHistory(beforeInput: unknown, afterInput?: unknown) {
  const before = parseHistorySnapshot(beforeInput), after = afterInput === undefined ? before : parseHistorySnapshot(afterInput);
  const babyIds = [...new Set([...before.activities, ...after.activities, ...(before.dailyStats || []), ...(after.dailyStats || [])].map(row => row.babyId))].sort();
  const babies = babyIds.map(babyId => {
    const first = summarize(before, babyId), second = summarize(after, babyId);
    const a = new Map(before.activities.filter(row => row.babyId === babyId).map(row => [row.id, row]));
    const b = new Map(after.activities.filter(row => row.babyId === babyId).map(row => [row.id, row]));
    const addedIds = [...b.keys()].filter(id => !a.has(id)).sort(), removedIds = [...a.keys()].filter(id => !b.has(id)).sort();
    const changedFactIds = [...a.keys()].filter(id => b.has(id) && factsFingerprint(a.get(id)!) !== factsFingerprint(b.get(id)!)).sort();
    const changedPhotoIds = [...a.keys()].filter(id => b.has(id) && (a.get(id)!.poopPhotoUrl || null) !== (b.get(id)!.poopPhotoUrl || null)).sort();
    const metrics = [...new Set([...first.dates, ...second.dates])].sort().flatMap(date => metricNames.flatMap(metric => {
      const original = first.daily.find(row => row.date === date)?.metrics[metric] || 0;
      const mapped = second.daily.find(row => row.date === date)?.metrics[metric] || 0;
      return original === mapped ? [] : [{ date, metric, before: original, after: mapped }];
    }));
    return { babyId, before: first, after: second, differences: { addedIds, removedIds, changedFactIds, changedPhotoIds, metrics,
      addedDates: second.dates.filter(date => !first.dates.includes(date)), removedDates: first.dates.filter(date => !second.dates.includes(date)),
      byType: first.byType.flatMap(row => { const mapped = second.byType.find(value => value.type === row.type)!; return row.activities === mapped.activities && row.photos === mapped.photos ? []
        : [{ type: row.type, beforeCount: row.activities, afterCount: mapped.activities, beforePhotos: row.photos, afterPhotos: mapped.photos }]; }) } };
  });
  const preserved = afterInput === undefined ? null : babies.every(({ differences: d }) => !d.addedIds.length && !d.removedIds.length && !d.changedFactIds.length && !d.metrics.length && !d.addedDates.length && !d.removedDates.length);
  const statisticsMatch = !before.dailyStats?.length && !after.dailyStats?.length ? null
    : babies.every(baby => [...baby.before.daily, ...baby.after.daily].every(day => !day.savedMetricDifferences.length));
  return { version: 1, mode: afterInput === undefined ? "single-export-mapping" : "before-after-comparison", preserved,
    statisticsMatch,
    notes: [
      "仅核对所提供的离线导出，不证明导出完整、线上迁移完成或照片原文件可读；照片只核对引用数量和引用变化，报告不输出照片地址。",
      "日期按 Asia/Shanghai 划分；跨日睡眠分摊到各日。旧记录缺结束时间保留未知，不推断持续进行。",
      "未知奶量和时长不等于已知 0；legacyUiDifferences 标出旧 UI 按 0 汇总的记录数，coverage 保留未知数量。",
      "旧 UI 尿量卡为 LARGE + ceil((SMALL + MEDIUM) / 2)，新统计分别显示实际尿布、明确有尿、明确有便次数，差异不代表记录丢失。",
      "旧首页次数使用 count || 1（已知 0 也显示 1），旧列表使用 count ?? 1；新统计只累计明确次数。",
      "savedMetricDifferences 比较导出中已有 DailyStat 字段与当前统一统计；未导出的日报或字段不被假定为 0。",
    ], babies };
}
