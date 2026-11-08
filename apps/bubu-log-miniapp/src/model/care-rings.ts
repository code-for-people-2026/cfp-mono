import { dateKey, dayBounds, monthBounds, timestamp, todayKey } from "./date";
import { buildHeatmap } from "./trends";
import type { Activity, DailyStat, DateInput } from "./types";
import type {
  BreastfeedRatePreference, CarePreferences, NumericRange,
} from "../preferences/care-preferences";

export type CareRingMetricKey = "milk" | "sleep" | "outdoor" | "diaper";
export type CareRingMetricUnit = "ml" | "minutes" | "count";
export type CareRingDataState = "known" | "partial" | "unknown";

export type CareRingRawValue =
  | { type: "number"; value: number }
  | { type: "range"; range: NumericRange }
  | { type: "unknown"; reason: string };

export interface CareRingTier { label: string; minutes: number }

export interface CareRingReference {
  label: string;
  kind: "range" | "target" | "tiers";
  range?: NumericRange;
  target?: number;
  tiers?: readonly CareRingTier[];
  source: "age-guidance" | "family-custom" | "family-goal";
  sourceKey: string;
  note: string;
}

export interface CareRingStatus {
  code: "unknown" | "no-reference" | "below-range" | "within-range" | "above-range" | "at-target";
  label: string;
  note?: string;
}

interface CareRingMetricBase {
  progress: number | null;
  value: CareRingRawValue;
  readableValue: string;
  status: CareRingStatus;
  reference: CareRingReference | null;
  dataState: CareRingDataState;
}

export interface MilkRingMetric extends CareRingMetricBase {
  key: "milk";
  label: "吃";
  unit: "ml";
  bottleMl: number | null;
  breastfeed: {
    state: "known-zero" | "known" | "estimated" | "partial" | "unknown" | "off" | "blocked";
    explicitMl: number | null;
    estimatedRange: NumericRange | null;
    recordedMinutes: number | null;
    recordCount: number;
    savedCount: number | null;
    source: "recorded-amount" | "rate-estimate" | "none" | "disabled" | "mixed" | "unavailable";
    reason: string | null;
  };
  readableComponents: readonly string[];
}

export interface SleepRingMetric extends CareRingMetricBase {
  key: "sleep";
  label: "睡";
  unit: "minutes";
  savedMinutes: number | null;
}

export interface OutdoorRingMetric extends CareRingMetricBase {
  key: "outdoor";
  label: "玩";
  unit: "minutes";
  recordedMinutes: number | null;
  recordCount: number;
}

export interface DiaperRingMetric extends CareRingMetricBase {
  key: "diaper";
  label: "便";
  unit: "count";
  count: number | null;
}

export type CareRingMetric = MilkRingMetric | SleepRingMetric | OutdoorRingMetric | DiaperRingMetric;
export type CareRingMetrics = readonly [MilkRingMetric, SleepRingMetric, OutdoorRingMetric, DiaperRingMetric];

export type CareRingAgeState = "known" | "missing" | "invalid" | "future";
export interface CareRingAge {
  state: CareRingAgeState;
  birthDate: string | null;
  completeMonths: number | null;
  days: number | null;
}

export interface CareRingCalendarDay {
  date: string;
  inMonth: boolean;
  isPadding: boolean;
  isToday: boolean;
  isFuture: boolean;
  isPast: boolean;
  hasSavedStat: boolean;
  dataState: CareRingDataState;
  age: CareRingAge;
  savedStat: DailyStat | null;
  metrics: CareRingMetrics;
}

export interface CareRingIssue {
  date: string | null;
  metric: CareRingMetricKey | null;
  code:
    | "activities-incomplete"
    | "duplicate-activity-id"
    | "invalid-activity-date"
    | "invalid-stat"
    | "duplicate-stat-date"
    | "invalid-breastfeed"
    | "breastfeed-mismatch"
    | "invalid-outdoor";
  message: string;
  activityId?: string;
}

export interface CareMonthRings {
  month: {
    year: number;
    month: number;
    first: string;
    last: string;
    today: string;
  };
  weeks: Array<{ start: string; days: CareRingCalendarDay[] }>;
  activitiesComplete: boolean;
  issues: CareRingIssue[];
  hasKnownDataIssues: boolean;
  allPastDaysHaveSavedStat: boolean;
}

export interface CareMonthRingsInput {
  /** All Activity rows relevant to the calendar month, including cross-midnight rows. */
  activities: readonly Activity[];
  /** Whether this Activity list is a complete page set (not limit-truncated or fetch-incomplete). */
  activitiesComplete: boolean;
  stats: readonly DailyStat[];
  monthDate: DateInput;
  today: DateInput;
  birthDate?: string | null;
  preferences: CarePreferences;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_OR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
function validDateKey(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function normalizeDateOrTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_OR_TIMESTAMP_PATTERN.test(value)) return null;
  // Reject impossible calendar days up front: Date.parse rolls 2026-02-30 over to March.
  if (!validDateKey(value.slice(0, 10))) return null;
  if (DATE_PATTERN.test(value)) return value;
  const withoutSpace = value.replace(" ", "T");
  const parseable = /(?:Z|[+-]\d{2}:?\d{2})$/.test(withoutSpace) ? withoutSpace : `${withoutSpace}+08:00`;
  if (!Number.isFinite(Date.parse(parseable))) return null;
  const normalized = dateKey(value);
  return validDateKey(normalized);
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function midpoint(range: NumericRange): number {
  return (range.min + range.max) / 2;
}

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

function formatRange(range: NumericRange): string {
  return `${formatNumber(range.min)}–${formatNumber(range.max)}`;
}

function formatMinutes(minutes: number): string {
  const whole = Math.floor(minutes);
  const hours = Math.floor(whole / 60);
  const remainder = whole % 60;
  if (!hours) return `${formatNumber(whole)}分钟`;
  return remainder ? `${hours}小时${remainder}分钟` : `${hours}小时`;
}

function rangeStatus(value: number, range: NumericRange, approximate: boolean): CareRingStatus {
  if (value < range.min) return { code: "below-range", label: "低于参考区间" };
  if (value > range.max) return { code: "above-range", label: "高于参考区间", note: "环已满不表示越多越好。" };
  return { code: "within-range", label: approximate ? "估算中值在参考区间" : "在参考区间内" };
}

function noReferenceStatus(reason: string): CareRingStatus {
  return { code: "no-reference", label: reason };
}

function unknownStatus(reason: string): CareRingStatus {
  return { code: "unknown", label: reason };
}

function ageFromBirth(birthDate: string | null | undefined, date: string): CareRingAge {
  const birth = normalizeDateOrTimestamp(birthDate);
  if (!birth) {
    return { state: birthDate ? "invalid" : "missing", birthDate: birthDate ?? null, completeMonths: null, days: null };
  }
  const dayTime = Date.parse(`${date}T00:00:00Z`);
  const birthTime = Date.parse(`${birth}T00:00:00Z`);
  if (dayTime < birthTime) return { state: "future", birthDate: birth, completeMonths: null, days: null };
  const after = new Date(dayTime);
  const born = new Date(birthTime);
  const calendarMonths = (after.getUTCFullYear() - born.getUTCFullYear()) * 12 + after.getUTCMonth() - born.getUTCMonth();
  const targetMonthLastDay = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 0)).getUTCDate();
  const anniversaryDay = Math.min(born.getUTCDate(), targetMonthLastDay);
  const completeMonths = after.getUTCDate() < anniversaryDay ? calendarMonths - 1 : calendarMonths;
  return {
    state: "known",
    birthDate: birth,
    completeMonths,
    days: (dayTime - birthTime) / 86_400_000,
  };
}

function milkAgeReference(age: CareRingAge): CareRingReference | null {
  if (age.state !== "known") return null;
  const months = age.completeMonths ?? 0;
  let range: NumericRange | null = null;
  if (age.days !== null && age.days >= 7 && months < 3) range = { min: 500, max: 750 };
  else if (months >= 3 && months < 5) range = { min: 800, max: 1000 };
  else if (months >= 5 && months < 6) range = { min: 750, max: 1000 };
  else if (months >= 6 && months < 7) range = { min: 800, max: 1000 };
  else if (months >= 7 && months < 10) range = { min: 700, max: 800 };
  else if (months >= 10 && months < 12) range = { min: 600, max: 700 };
  else if (months >= 12 && months < 24) range = { min: 400, max: 600 };
  else if (months >= 24 && months < 60) range = { min: 300, max: 500 };
  if (!range) return null;
  return {
    label: `年龄参考 ${formatRange(range)} ml/日`,
    kind: "range",
    range,
    source: "age-guidance",
    sourceKey: "beijing-2021+nhc-2025",
    note: "粗略公开资料参考，按满月龄实现；不是喂养处方。出生未满 7 天不自动套用。",
  };
}

function sleepAgeReference(age: CareRingAge): CareRingReference | null {
  if (age.state !== "known") return null;
  const months = age.completeMonths ?? 0;
  let range: NumericRange | null = null;
  if (months < 4) range = { min: 840, max: 1020 };
  else if (months < 12) range = { min: 720, max: 960 };
  else if (months < 36) range = { min: 660, max: 840 };
  else if (months < 60) range = { min: 600, max: 780 };
  if (!range) return null;
  return {
    label: `年龄参考 ${formatMinutes(range.min)}–${formatMinutes(range.max)}`,
    kind: "range",
    range,
    source: "age-guidance",
    sourceKey: "who-2019",
    note: "仅作视觉参考，不是睡眠评价或处方。",
  };
}

function customRangeReference(range: NumericRange, unit: "ml" | "minutes", label: string): CareRingReference {
  return {
    label: `${label} ${unit === "ml" ? `${formatRange(range)} ml/日` : `${formatMinutes(range.min)}–${formatMinutes(range.max)}`}`,
    kind: "range",
    range,
    source: "family-custom",
    sourceKey: "family-or-clinician-choice",
    note: "家庭/临床自定义参考，仅用于展示。",
  };
}

function outdoorReference(): CareRingReference {
  return {
    label: "家庭户外参考：60/120/180 分钟",
    kind: "tiers",
    target: 180,
    tiers: [
      { label: "合格", minutes: 60 },
      { label: "良好", minutes: 120 },
      { label: "优秀", minutes: 180 },
    ],
    source: "family-goal",
    sourceKey: "family-request",
    note: "180 分钟填满整环；这是家庭目标分层，不构成健康声明。",
  };
}

function diaperReference(): CareRingReference {
  return {
    label: "家庭目标 6 次/日",
    kind: "target",
    target: 6,
    source: "family-goal",
    sourceKey: "family-request",
    note: "统计全部换尿布次数；6 次是家庭目标，不是医学正常值。",
  };
}

function rateLabel(rate: BreastfeedRatePreference): string {
  return rate.mode === "off" ? "已关闭" : `${formatNumber(rate.range.min)}–${formatNumber(rate.range.max)} ml/分钟`;
}

function rawNumber(value: number): Extract<CareRingRawValue, { type: "number" }> {
  return { type: "number", value };
}

function rawRange(range: NumericRange): Extract<CareRingRawValue, { type: "range" }> {
  return { type: "range", range };
}

function rawUnknown(reason: string): Extract<CareRingRawValue, { type: "unknown" }> {
  return { type: "unknown", reason };
}

interface BuildContext {
  issues: CareRingIssue[];
  uniqueActivities: Activity[];
  byDate: Map<string, DailyStat>;
}

function addIssue(context: BuildContext, issue: CareRingIssue): void {
  context.issues.push(issue);
}

function dedupeActivities(activities: readonly Activity[], context: BuildContext): Activity[] {
  const byId = new Map<string, Activity>();
  const result: Activity[] = [];
  for (const activity of activities) {
    if (!activity || typeof activity.id !== "string" || !activity.id) {
      addIssue(context, { date: null, metric: null, code: "invalid-activity-date", message: "活动缺少有效 ID。" });
      continue;
    }
    if (byId.has(activity.id)) {
      addIssue(context, { date: null, metric: "outdoor", code: "duplicate-activity-id", message: `重复活动 ID ${activity.id} 只计一次。`, activityId: activity.id });
      continue;
    }
    byId.set(activity.id, activity);
    result.push(activity);
  }
  return result;
}

function buildStatsMap(stats: readonly DailyStat[], context: BuildContext): Map<string, DailyStat> {
  const byDate = new Map<string, DailyStat>();
  for (const stat of stats) {
    const date = normalizeDateOrTimestamp(stat?.date);
    if (!stat || !date) {
      addIssue(context, { date: null, metric: null, code: "invalid-stat", message: "每日统计缺少有效日期。" });
      continue;
    }
    if (byDate.has(date)) {
      addIssue(context, { date, metric: null, code: "duplicate-stat-date", message: "同一日期出现多个每日统计。" });
    }
    byDate.set(date, stat);
  }
  return byDate;
}

function calculateBreastfeed(
  activities: readonly Activity[],
  stat: DailyStat | null,
  complete: boolean,
  age: CareRingAge,
  rate: BreastfeedRatePreference,
  date: string,
  context: BuildContext,
): MilkRingMetric["breastfeed"] {
  const records = activities.filter((activity) => activity.type === "BREASTFEED" && dateKey(activity.startTime) === date);
  let explicitMl = 0;
  let hasExplicit = false;
  let invalidExplicit = false;
  let eligibleMinutes = 0;
  let recordedMinutes = 0;
  let invalidDuration = false;
  let durationRecordCount = 0;
  let perRecordRoundedMinutes = 0;

  for (const activity of records) {
    const amount = activity.milkAmount;
    if (amount !== undefined && amount !== null) {
      if (finiteNonNegative(amount) === null) {
        invalidExplicit = true;
        addIssue(context, { date, metric: "milk", code: "invalid-breastfeed", message: "亲喂记录奶量无效。", activityId: activity.id });
      } else {
        explicitMl += amount;
        hasExplicit = true;
      }
      continue;
    }
    const start = timestamp(activity.startTime);
    const end = activity.endTime === undefined || activity.endTime === null ? NaN : timestamp(activity.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      invalidDuration = true;
      addIssue(context, { date, metric: "milk", code: "invalid-breastfeed", message: "亲喂记录缺少有效结束时间，不能按时长估算。", activityId: activity.id });
      continue;
    }
    const minutes = (end - start) / 60_000;
    recordedMinutes += minutes;
    eligibleMinutes += minutes;
    // Legacy DailyStats round each feed before totaling; estimates retain raw durations.
    perRecordRoundedMinutes += Math.round(minutes);
    durationRecordCount += 1;
  }

  const savedCountRaw = stat?.breastfeedCount;
  const savedCount = savedCountRaw === undefined || savedCountRaw === null ? null : finiteNonNegative(savedCountRaw);
  const invalidSavedCount = savedCountRaw !== undefined && savedCountRaw !== null
    && (savedCount === null || !Number.isInteger(savedCount));
  if (invalidSavedCount) {
    addIssue(context, { date, metric: "milk", code: "invalid-stat", message: "已保存亲喂次数无效。" });
  }
  const savedMinutesRaw = stat?.totalBreastfeedMinutes;
  const savedMinutes = savedMinutesRaw === undefined || savedMinutesRaw === null ? null : finiteNonNegative(savedMinutesRaw);
  const invalidSavedMinutes = savedMinutesRaw !== undefined && savedMinutesRaw !== null && savedMinutes === null;
  if (invalidSavedMinutes) {
    addIssue(context, { date, metric: "milk", code: "invalid-stat", message: "已保存亲喂时长无效。" });
  }
  const roundedMinutes = Math.round(recordedMinutes);

  let mismatch = false;
  if (savedCount !== null && savedCount !== records.length) {
    mismatch = true;
    addIssue(context, {
      date,
      metric: "milk",
      code: "breastfeed-mismatch",
      message: `已保存亲喂 ${savedCount} 次，Activity 返回 ${records.length} 次；不补造缺失记录。`,
    });
  }
  if (savedCount === null && savedMinutes !== null && savedMinutes > 0 && records.length === 0) {
    mismatch = true;
    addIssue(context, { date, metric: "milk", code: "breastfeed-mismatch", message: "已保存亲喂时长大于 0，但 Activity 未返回亲喂记录。" });
  }
  if (savedMinutes !== null && durationRecordCount > 0 && durationRecordCount === records.length
    && Math.abs(Math.round(savedMinutes) - perRecordRoundedMinutes) > 1) {
    mismatch = true;
    addIssue(context, {
      date,
      metric: "milk",
      code: "breastfeed-mismatch",
      message: `已保存亲喂时长与 Activity 时长不一致（${formatNumber(savedMinutes)} 分钟 / ${formatNumber(recordedMinutes)} 分钟）。`,
    });
  }

  let estimatedRange: NumericRange | null = null;
  let blockedReason: string | null = null;
  if (eligibleMinutes > 0) {
    if (rate.mode === "off") blockedReason = "亲喂速率估算已关闭。";
    else if (rate.mode === "research" && (
      age.state === "missing" || (age.state === "known" && age.days !== null && age.days < 7)
    )) {
      blockedReason = "出生日期未知或未满 7 天，不自动使用默认研究启发区间。";
    } else if (age.state === "invalid" || age.state === "future") {
      blockedReason = "出生日期无效或晚于当前日期。";
    } else {
      estimatedRange = {
        min: Math.round(eligibleMinutes * rate.range.min),
        max: Math.round(eligibleMinutes * rate.range.max),
      };
    }
  }

  const invalid = invalidExplicit || invalidDuration || invalidSavedCount || invalidSavedMinutes;
  if (!complete) {
    return {
      state: "unknown",
      explicitMl: hasExplicit || invalidExplicit ? explicitMl : null,
      estimatedRange,
      recordedMinutes: roundedMinutes,
      recordCount: records.length,
      savedCount,
      source: records.length ? "mixed" : "unavailable",
      reason: "Activity 月度列表不完整，亲喂可能缺失。",
    };
  }
  if (invalid || mismatch) {
    return {
      state: "partial",
      explicitMl: hasExplicit || invalidExplicit ? explicitMl : null,
      estimatedRange,
      recordedMinutes: roundedMinutes,
      recordCount: records.length,
      savedCount,
      source: hasExplicit || estimatedRange ? "mixed" : "unavailable",
      reason: "亲喂记录或已保存统计不完整/不一致。",
    };
  }
  if (records.length === 0) {
    return {
      state: "known-zero",
      explicitMl: 0,
      estimatedRange: null,
      recordedMinutes: 0,
      recordCount: 0,
      savedCount,
      source: "none",
      reason: null,
    };
  }
  if (blockedReason) {
    return {
      state: rate.mode === "off" ? "off" : "blocked",
      explicitMl: hasExplicit ? explicitMl : null,
      estimatedRange: null,
      recordedMinutes: roundedMinutes,
      recordCount: records.length,
      savedCount,
      source: hasExplicit ? "mixed" : rate.mode === "off" ? "disabled" : "unavailable",
      reason: blockedReason,
    };
  }
  if (estimatedRange) {
    return {
      state: "estimated",
      explicitMl: hasExplicit ? explicitMl : null,
      estimatedRange,
      recordedMinutes: roundedMinutes,
      recordCount: records.length,
      savedCount,
      source: hasExplicit ? "mixed" : "rate-estimate",
      reason: `按 ${rateLabel(rate)} 估算。`,
    };
  }
  return {
    state: "known",
    explicitMl,
    estimatedRange: null,
    recordedMinutes: roundedMinutes,
    recordCount: records.length,
    savedCount,
    source: "recorded-amount",
    reason: null,
  };
}

function buildMilkMetric(
  stat: DailyStat | null,
  breastfeed: MilkRingMetric["breastfeed"],
  age: CareRingAge,
  preferences: CarePreferences,
): MilkRingMetric {
  const bottle = stat ? finiteNonNegative(stat.totalMilkAmount) : null;
  const reference = preferences.milkReference
    ? customRangeReference(preferences.milkReference, "ml", "自定义奶量参考")
    : milkAgeReference(age);
  const components: string[] = [];
  components.push(bottle === null ? "瓶喂未知" : `瓶喂 ${formatNumber(bottle)} ml`);
  if (breastfeed.recordCount > 0 || breastfeed.state === "known-zero") {
    if (breastfeed.explicitMl !== null) components.push(`亲喂记录量 ${formatNumber(breastfeed.explicitMl)} ml`);
    if (breastfeed.estimatedRange) components.push(`亲喂估算 ${formatRange(breastfeed.estimatedRange)} ml`);
    if (breastfeed.recordedMinutes !== null && breastfeed.explicitMl === null && !breastfeed.estimatedRange) {
      components.push(`亲喂时长 ${formatNumber(breastfeed.recordedMinutes)} 分钟`);
    }
  }

  if (breastfeed.state === "estimated" && breastfeed.estimatedRange === null) {
    return {
      key: "milk",
      label: "吃",
      unit: "ml",
      bottleMl: bottle,
      breastfeed,
      value: rawUnknown("亲喂估算区间无效，不能合计总奶量。"),
      readableValue: "未知",
      readableComponents: components,
      progress: null,
      status: unknownStatus("总奶量未知"),
      reference,
      dataState: "partial",
    };
  }
  const estimatedRange = breastfeed.state === "estimated" ? breastfeed.estimatedRange : null;
  const canTotal = bottle !== null && (
    breastfeed.state === "known-zero" ||
    breastfeed.state === "known" ||
    breastfeed.state === "estimated"
  );
  let value: CareRingRawValue;
  if (!canTotal) {
    value = rawUnknown(bottle === null ? "瓶喂奶量未知，不能合计总奶量。" : "亲喂奶量未知，不能合计总奶量。");
  } else if (breastfeed.state === "estimated" && estimatedRange) {
    const explicit = breastfeed.explicitMl ?? 0;
    value = rawRange({ min: bottle + explicit + estimatedRange.min, max: bottle + explicit + estimatedRange.max });
  } else {
    value = rawNumber(bottle + (breastfeed.explicitMl ?? 0));
  }

  let progress: number | null = null;
  let status: CareRingStatus;
  if (value.type === "unknown") status = unknownStatus("总奶量未知");
  else if (!reference?.range) status = noReferenceStatus(age.state === "known" && age.days !== null && age.days < 7 ? "未满 7 天无自动年龄参考" : "无奶量参考");
  else {
    const estimate = value.type === "range" ? midpoint(value.range) : value.value;
    progress = clampProgress(estimate / midpoint(reference.range));
    status = rangeStatus(estimate, reference.range, value.type === "range");
  }
  return {
    key: "milk",
    label: "吃",
    unit: "ml",
    bottleMl: bottle,
    breastfeed,
    value,
    readableValue: value.type === "number" ? `${formatNumber(value.value)} ml` : value.type === "range" ? `约 ${formatRange(value.range)} ml` : "未知",
    progress,
    status,
    reference,
    dataState: value.type === "unknown" ? "partial" : "known",
    readableComponents: components,
  };
}

function buildSleepMetric(stat: DailyStat | null, age: CareRingAge, preferences: CarePreferences): SleepRingMetric {
  const saved = stat ? finiteNonNegative(stat.totalSleepMinutes) : null;
  const reference = preferences.sleepReference
    ? customRangeReference(preferences.sleepReference, "minutes", "自定义睡眠参考")
    : sleepAgeReference(age);
  const value = saved === null ? rawUnknown("缺少有效睡眠统计") : rawNumber(saved);
  let progress: number | null = null;
  let status: CareRingStatus;
  if (saved === null) status = unknownStatus("睡眠未知");
  else if (!reference?.range) status = noReferenceStatus(age.state === "missing" || age.state === "invalid" || age.state === "future" ? "年龄未知或不受支持，不猜测睡眠参考" : "无睡眠参考");
  else {
    progress = clampProgress(saved / midpoint(reference.range));
    status = rangeStatus(saved, reference.range, false);
  }
  return {
    key: "sleep",
    label: "睡",
    unit: "minutes",
    savedMinutes: saved,
    value,
    readableValue: saved === null ? "未知" : formatMinutes(saved),
    progress,
    status,
    reference,
    dataState: saved === null ? "unknown" : "known",
  };
}

function outdoorRecordsForDay(activities: readonly Activity[], date: string): Activity[] {
  const bounds = dayBounds(date);
  return activities.filter((activity) => {
    if (activity.type !== "OUTDOOR") return false;
    const start = timestamp(activity.startTime);
    if (!Number.isFinite(start) || start >= bounds.next) return false;
    if (start >= bounds.start) return true;
    const end = activity.endTime === undefined || activity.endTime === null ? NaN : timestamp(activity.endTime);
    // An unfinished activity can remain open for longer than one day. Once its
    // start precedes the affected day, only a valid end can prove no overlap;
    // absence or invalidity of that end leaves the affected day unknown.
    return Number.isFinite(end) ? end > bounds.start : true;
  });
}

function mergedOutdoorMinutes(activities: readonly Activity[], date: string): number {
  const bounds = dayBounds(date);
  const segments = activities.flatMap((activity) => {
    const start = Math.max(timestamp(activity.startTime), bounds.start);
    const end = Math.min(timestamp(activity.endTime ?? ""), bounds.next);
    return start < end ? [[start, end] as const] : [];
  }).sort((left, right) => left[0] - right[0]);
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const [start, end] of segments) {
    if (currentStart === null || start > currentEnd) {
      if (currentStart !== null) total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    } else if (end > currentEnd) currentEnd = end;
  }
  if (currentStart !== null) total += currentEnd - currentStart;
  return Math.round(total / 60_000);
}

function buildOutdoorMetric(
  allActivities: readonly Activity[],
  statExists: boolean,
  complete: boolean,
  date: string,
  context: BuildContext,
): OutdoorRingMetric {
  const reference = outdoorReference();
  const records = outdoorRecordsForDay(allActivities, date);
  if (!statExists) {
    if (records.length === 0) {
      return {
        key: "outdoor", label: "玩", unit: "minutes", recordedMinutes: null, recordCount: 0,
        value: rawUnknown("该日没有统计快照或户外记录"), readableValue: "未知", progress: null,
        status: unknownStatus("户外时长未知"), reference, dataState: "unknown",
      };
    }
  }
  let invalid = false;
  for (const activity of records) {
    const end = activity.endTime === undefined || activity.endTime === null ? NaN : timestamp(activity.endTime);
    if (!Number.isFinite(end) || end <= timestamp(activity.startTime)) {
      invalid = true;
      addIssue(context, { date, metric: "outdoor", code: "invalid-outdoor", message: "户外记录未结束或结束时间无效。", activityId: activity.id });
    }
  }
  const minutes = mergedOutdoorMinutes(records, date);
  const known = complete && !invalid;
  const value = known ? rawNumber(minutes) : rawUnknown(complete ? "户外记录不完整" : "Activity 月度列表不完整");
  const achievement = known && minutes >= 180 ? 3 : known && minutes >= 120 ? 2 : known && minutes >= 60 ? 1 : 0;
  const status: CareRingStatus = !known
    ? unknownStatus("户外时长未知")
    : {
      code: achievement === 3 ? "at-target" : "below-range",
      label: achievement === 0 ? "未到 60 分钟" : `达到 ${achievement === 1 ? 60 : achievement === 2 ? 120 : 180} 分钟`,
      note: achievement === 3 ? "整环已满，仍保留实际分钟数。" : undefined,
    };
  return {
    key: "outdoor",
    label: "玩",
    unit: "minutes",
    recordedMinutes: minutes,
    recordCount: records.length,
    value,
    readableValue: known ? formatMinutes(minutes) : "未知",
    progress: known ? clampProgress(minutes / 180) : null,
    status,
    reference,
    dataState: known ? "known" : "partial",
  };
}

function buildDiaperMetric(stat: DailyStat | null): DiaperRingMetric {
  const reference = diaperReference();
  const count = stat ? finiteNonNegative(stat.diaperCount) : null;
  const value = count === null ? rawUnknown("缺少有效尿布统计") : rawNumber(count);
  return {
    key: "diaper",
    label: "便",
    unit: "count",
    count,
    value,
    readableValue: count === null ? "未知" : `${formatNumber(count)} 次`,
    progress: count === null ? null : clampProgress(count / 6),
    status: count === null ? unknownStatus("尿布次数未知") : {
      code: count >= 6 ? "at-target" : "below-range",
      label: count >= 6 ? "达到家庭目标 6 次" : "少于家庭目标 6 次",
      note: "只描述与家庭目标的关系，不是医学正常值。",
    },
    reference,
    dataState: count === null ? "unknown" : "known",
  };
}

function unknownMetrics(reason: string): CareRingMetrics {
  const value = rawUnknown(reason);
  const status = unknownStatus(reason);
  return [
    { key: "milk", label: "吃", unit: "ml", bottleMl: null, breastfeed: { state: "unknown", explicitMl: null, estimatedRange: null, recordedMinutes: null, recordCount: 0, savedCount: null, source: "unavailable", reason }, value, readableValue: "未知", readableComponents: ["总奶量未知"], progress: null, status, reference: null, dataState: "unknown" },
    { key: "sleep", label: "睡", unit: "minutes", savedMinutes: null, value, readableValue: "未知", progress: null, status, reference: null, dataState: "unknown" },
    { key: "outdoor", label: "玩", unit: "minutes", recordedMinutes: null, recordCount: 0, value, readableValue: "未知", progress: null, status, reference: null, dataState: "unknown" },
    { key: "diaper", label: "便", unit: "count", count: null, value, readableValue: "未知", progress: null, status, reference: null, dataState: "unknown" },
  ];
}

/**
 * Builds a pure Monday-first Shanghai calendar-month display model.
 * Saved DailyStat fields are passed through verbatim; Activity-derived fields are display-only.
 */
export function buildCareMonthRings(input: CareMonthRingsInput): CareMonthRings {
  const issues: CareRingIssue[] = [];
  const context: BuildContext = { issues, uniqueActivities: [], byDate: new Map() };
  if (!input.activitiesComplete) {
    issues.push({ date: null, metric: null, code: "activities-incomplete", message: "Activity 月度列表不完整。" });
  }
  context.uniqueActivities = dedupeActivities(input.activities, context);
  context.byDate = buildStatsMap(input.stats, context);
  const grid = buildHeatmap([], input.monthDate, input.today);
  const bounds = monthBounds(input.monthDate);
  const today = todayKey(input.today);
  const seenDays = new Set<string>();
  let allPastDaysHaveSavedStat = true;

  const weeks = grid.weeks.map((week) => ({
    start: week.start,
    days: week.days.map<CareRingCalendarDay>((cell) => {
      if (!cell.inMonth || cell.isFuture || !cell.date) {
        return {
          date: cell.date,
          inMonth: cell.inMonth,
          isPadding: cell.isPadding,
          isToday: cell.inMonth && cell.isToday,
          isFuture: cell.inMonth && cell.date > today,
          isPast: cell.inMonth && cell.date < today,
          hasSavedStat: false,
          dataState: "unknown",
          age: ageFromBirth(input.birthDate, cell.date),
          savedStat: null,
          metrics: unknownMetrics(cell.isPadding ? "月历填充位" : cell.isFuture ? "未来日期" : "无数据"),
        };
      }
      const date = cell.date;
      seenDays.add(date);
      const stat = context.byDate.get(date) ?? null;
      if (!stat) allPastDaysHaveSavedStat = false;
      if (stat) {
        if (finiteNonNegative(stat.totalMilkAmount) === null) addIssue(context, { date, metric: "milk", code: "invalid-stat", message: "瓶喂奶量统计无效。" });
        if (finiteNonNegative(stat.totalSleepMinutes) === null) addIssue(context, { date, metric: "sleep", code: "invalid-stat", message: "睡眠统计无效。" });
        if (finiteNonNegative(stat.diaperCount) === null) addIssue(context, { date, metric: "diaper", code: "invalid-stat", message: "尿布统计无效。" });
      }
      const age = ageFromBirth(input.birthDate, date);
      const breastfeed = calculateBreastfeed(context.uniqueActivities, stat, input.activitiesComplete, age, input.preferences.breastfeedRate, date, context);
      const metrics: CareRingMetrics = [
        buildMilkMetric(stat, breastfeed, age, input.preferences),
        buildSleepMetric(stat, age, input.preferences),
        buildOutdoorMetric(context.uniqueActivities, Boolean(stat), input.activitiesComplete, date, context),
        buildDiaperMetric(stat),
      ];
      const hasKnownData = metrics.some((metric) => metric.dataState !== "unknown");
      const allMetricsKnown = metrics.every((metric) => metric.dataState === "known");
      const dataState = !stat && !hasKnownData ? "unknown" : allMetricsKnown ? "known" : "partial";
      return {
        date,
        inMonth: true,
        isPadding: false,
        isToday: date === today,
        isFuture: false,
        isPast: date < today,
        hasSavedStat: Boolean(stat),
        dataState,
        age,
        savedStat: stat,
        metrics,
      };
    }),
  }));

  return {
    month: { year: bounds.year, month: bounds.month, first: bounds.first, last: bounds.last, today },
    weeks,
    activitiesComplete: input.activitiesComplete,
    issues,
    hasKnownDataIssues: issues.length > 0,
    allPastDaysHaveSavedStat: allPastDaysHaveSavedStat && seenDays.size > 0,
  };
}
