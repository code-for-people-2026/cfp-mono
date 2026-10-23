import { AppError } from "../contracts";
import { activityTypes, type CareEvent, type DailyMetrics, type Facts, type Field, type LegacyActivity } from "./types";

const dayMs = 86_400_000;
export function chinaDate(value: string | number): string {
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new AppError(400, "INVALID_DATE", "日期无效");
  return new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
}
/** Half-open boundaries avoid assigning a midnight point to two dates. */
export function chinaDayRange(date: string): { start: number; end: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, "INVALID_DATE", "日期格式应为 YYYY-MM-DD");
  const start = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(start) || chinaDate(start) !== date) throw new AppError(400, "INVALID_DATE", "日期无效");
  return { start, end: start + dayMs };
}
/** An old-site edit invalidates stale ongoing metadata without changing its audit revision. */
export function isActivityOngoing(activity: Facts, event?: CareEvent): boolean {
  return !!event && event.projection === "synced" && event.lifecycle === "active" && event.progress === "ongoing"
    && activity.type === event.facts.type && Number.isFinite(Date.parse(activity.startTime || ""))
    && Date.parse(activity.startTime || "") === Date.parse(event.facts.startTime || "")
    && !activity.endTime && !event.facts.endTime;
}
function overlapsDate(facts: Facts, dayStart: number, dayEnd: number, ongoing: boolean, now: number): boolean {
  const start = Date.parse(facts.startTime || ""); const end = Date.parse(facts.endTime || "");
  return Number.isFinite(start) && ((start >= dayStart && start < dayEnd) || (start < dayEnd && Number.isFinite(end) && end > dayStart)
    || (ongoing && !Number.isFinite(end) && start <= now && start < dayEnd && now >= dayStart));
}
export function activityInDate(facts: Facts, date: string, ongoing = false, now = Date.now()): boolean {
  const { start, end } = chinaDayRange(date);
  return overlapsDate(facts, start, end, ongoing, now);
}
export function affectedDates(activities: Facts[]): string[] {
  const result = new Set<string>();
  for (const activity of activities) {
    const start = Date.parse(activity.startTime || ""); const end = Date.parse(activity.endTime || "");
    if (!Number.isFinite(start)) continue;
    const first = chinaDayRange(chinaDate(start)).start;
    const last = Number.isFinite(end) && end > start ? chinaDayRange(chinaDate(end - 1)).start : first;
    // Invalid multi-century input must not create an unbounded remote refresh loop.
    if ((last - first) / dayMs > 3660) throw new AppError(400, "INTERVAL_TOO_LONG", "请核对活动日期范围");
    for (let at = first; at <= last; at += dayMs) result.add(chinaDate(at));
  }
  return [...result].sort();
}
export function emptyDailyMetrics(): DailyMetrics {
  return { sleepCount: 0, totalSleepMinutes: 0, breastfeedCount: 0, totalBreastfeedMinutes: 0,
    bottleCount: 0, totalMilkAmount: 0, pumpCount: 0, totalPumpMilkAmount: 0,
    diaperCount: 0, poopCount: 0, peeCount: 0, exerciseCount: 0, totalHeadLiftMinutes: 0,
    supplementADCount: 0, supplementD3Count: 0, supplementProbioticsCount: 0,
    supplementPrebioticsCount: 0, spitUpCount: 0, projectileSpitUpCount: 0 };
}
export interface StatisticsCoverage {
  recordedEvents: number; incompleteEvents: number; pendingFields: number; unknownFields: number;
  ongoingEvents: number; pendingCandidates: number; duplicateCandidates: number; unresolvedTime: number;
  knownMilkAmounts: number; unknownMilkAmounts: number; knownZeroMilkAmounts: number;
  eventsWithUnknownFields: string[]; pendingEventIds: string[];
}
export interface TypeStatistics { events: number; knownMinutes: number; knownCount: number; unknownCount: number; knownMilkAmount: number; preparedMilkAmount: number;
  knownMilkAmounts: number; unknownMilkAmounts: number; knownDurations: number; unknownDurations: number; ongoingEvents: number }

/** Old DailyStat metrics retain their original meaning; coverage and per-type details are separate. */
export function computeStatistics(activities: LegacyActivity[], date: string, events: CareEvent[] = [], now = Date.now()): { metrics: DailyMetrics; coverage: StatisticsCoverage; byType: Record<string, TypeStatistics> } {
  const { start: dayStart, end: dayEnd } = chinaDayRange(date);
  const metrics = emptyDailyMetrics();
  const coverage: StatisticsCoverage = { recordedEvents: 0, incompleteEvents: 0, pendingFields: 0, unknownFields: 0,
    ongoingEvents: 0, pendingCandidates: 0, duplicateCandidates: 0, unresolvedTime: 0,
    knownMilkAmounts: 0, unknownMilkAmounts: 0, knownZeroMilkAmounts: 0, eventsWithUnknownFields: [], pendingEventIds: [] };
  const byType = Object.fromEntries(activityTypes.map(type => [type, { events: 0, knownMinutes: 0, knownCount: 0, unknownCount: 0, knownMilkAmount: 0, preparedMilkAmount: 0,
    knownMilkAmounts: 0, unknownMilkAmounts: 0, knownDurations: 0, unknownDurations: 0, ongoingEvents: 0 }])) as Record<string, TypeStatistics>;
  const managed = new Map(events.map(event => [event.legacyId, event]));
  const observed = new Map(activities.map(activity => [activity.id, activity]));
  const inDate = (facts: Facts, ongoing = false) => overlapsDate(facts, dayStart, dayEnd, ongoing, now);
  for (const event of events) {
    if (event.lifecycle !== "active") continue;
    const current = event.projection === "synced" ? observed.get(event.legacyId) : undefined;
    if (event.projection === "synced" && event.projected && !current) continue;
    const facts = current || event.facts;
    const ongoing = current ? isActivityOngoing(current, event) : event.progress === "ongoing" && !facts.endTime;
    if (!facts.startTime) { coverage.unresolvedTime++; continue; }
    if (!inDate(facts, ongoing)) continue;
    let newlyDueOutcomes = false;
    const states = Object.entries(event.states).filter(([name]) => {
      if (!current) return true;
      if (current.type !== event.facts.type) return false;
      const field = name as Field;
      // A previously unknown end/duration becomes known when the old site saves it.
      if (field === "durationMinutes") return !current.endTime && Date.parse(current.startTime) === Date.parse(event.facts.startTime || "");
      if (["preparedMilkAmount", "remainingMilkAmount", "sameBottle"].includes(field)) return Date.parse(current.startTime) === Date.parse(event.facts.startTime || "");
      return (current[field] ?? null) === (event.facts[field] ?? null);
    }).flatMap(([name, state]) => {
      if (current?.endTime && state === "not_yet") {
        if (name === "milkAmount" || name === "burpSuccess") { newlyDueOutcomes = true; return ["pending"]; }
        return [];
      }
      return [state];
    });
    const pending = states.filter(state => state === "pending").length;
    const unknown = states.filter(state => state === "unknown").length;
    if (event.duplicateCandidates.length) coverage.duplicateCandidates++;
    if (event.projection !== "synced") { coverage.pendingCandidates++; coverage.pendingEventIds.push(event.id); }
    if ((!event.complete || newlyDueOutcomes) && (!current || pending || unknown || event.conflicts.length || event.duplicateCandidates.length)) coverage.incompleteEvents++;
    coverage.pendingFields += pending;
    coverage.unknownFields += unknown;
    if (unknown) coverage.eventsWithUnknownFields.push(event.id);
    if (ongoing) coverage.ongoingEvents++;
  }
  const seen = new Set<string>();
  for (const activity of activities) {
    if (seen.has(activity.id)) continue;
    seen.add(activity.id);
    const event = managed.get(activity.id);
    if (event && ((event.projection === "synced" && event.lifecycle !== "active") || (event.duplicateCandidates.length && !event.projected))) continue;
    const start = Date.parse(activity.startTime); const end = Date.parse(activity.endTime || "");
    // Only confirmed, matching ongoing metadata extends across midnight. A stale
    // sidecar annotation cannot conceal an end saved by the legacy application.
    const ongoing = isActivityOngoing(activity, event);
    if (!Number.isFinite(start) || !inDate(activity, ongoing) || !byType[activity.type]) continue;
    const inStartDay = start >= dayStart && start < dayEnd;
    const known = (field: Field) => {
      // A pending revision does not erase the prior persisted fact. Old-site edits also outrank stale metadata.
      if (!event || event.projection !== "synced" || (activity[field] ?? null) !== (event.facts[field] ?? null)) return activity[field] !== null && activity[field] !== undefined;
      return event.states[field] === "known" || (event.states[field] === undefined && activity[field] !== null && activity[field] !== undefined);
    };
    const nonnegative = (field: "milkAmount" | "count" | "preparedMilkAmount") => known(field) && typeof activity[field] === "number" && Number.isFinite(activity[field]) && activity[field] >= 0;
    const hasEnd = Number.isFinite(end) && end >= start && known("endTime") && !ongoing;
    const wholeMinutes = hasEnd ? Math.max(0, Math.round((end - start) / 60_000)) : 0;
    const overlapMinutes = hasEnd ? Math.max(0, Math.round((Math.min(end, dayEnd) - Math.max(start, dayStart)) / 60_000)) : 0;
    const summary = byType[activity.type]!;
    coverage.recordedEvents++;
    if (inStartDay || activity.type === "SLEEP" || ongoing) summary.events++;
    summary.knownMinutes += activity.type === "SLEEP" ? overlapMinutes : inStartDay ? wholeMinutes : 0;
    if (inStartDay || activity.type === "SLEEP" || ongoing) {
      if (hasEnd) summary.knownDurations++;
      else if (ongoing) summary.ongoingEvents++;
      else summary.unknownDurations++;
    }
    if (inStartDay && (activity.type === "ROLL_OVER" || activity.type === "PULL_TO_SIT")) {
      if (nonnegative("count")) summary.knownCount += activity.count!;
      else summary.unknownCount++;
    }
    if (inStartDay && (activity.type === "BOTTLE" || activity.type === "PUMP")) {
      if (nonnegative("milkAmount")) {
        summary.knownMilkAmount += activity.milkAmount!;
        summary.knownMilkAmounts++;
        coverage.knownMilkAmounts++;
        if (activity.milkAmount === 0) coverage.knownZeroMilkAmounts++;
      } else if (!ongoing) { coverage.unknownMilkAmounts++; summary.unknownMilkAmounts++; }
      if (activity.type === "BOTTLE" && activity.milkSource === "FORMULA" && event?.projection === "synced" && event.facts.milkSource === "FORMULA"
        && start === Date.parse(event.facts.startTime || "") && event.states.preparedMilkAmount === "known" && typeof event.facts.preparedMilkAmount === "number") summary.preparedMilkAmount += event.facts.preparedMilkAmount;
    }
    switch (activity.type) {
      case "SLEEP": if (hasEnd && overlapMinutes > 0) { metrics.sleepCount!++; metrics.totalSleepMinutes! += overlapMinutes; } break;
      case "BREASTFEED": if (inStartDay) { metrics.breastfeedCount!++; metrics.totalBreastfeedMinutes! += wholeMinutes; } break;
      case "BOTTLE": if (inStartDay) { metrics.bottleCount!++; if (nonnegative("milkAmount")) metrics.totalMilkAmount! += activity.milkAmount!; } break;
      case "PUMP": if (inStartDay) { metrics.pumpCount!++; if (nonnegative("milkAmount")) metrics.totalPumpMilkAmount! += activity.milkAmount!; } break;
      case "DIAPER": metrics.diaperCount!++; if (known("hasPoop") && activity.hasPoop === true) metrics.poopCount!++; if (known("hasPee") && activity.hasPee === true) metrics.peeCount!++; break;
      case "HEAD_LIFT": if (inStartDay) { metrics.exerciseCount!++; metrics.totalHeadLiftMinutes! += wholeMinutes; } break;
      case "PASSIVE_EXERCISE": case "GAS_EXERCISE": case "BATH": case "OUTDOOR": case "EARLY_EDUCATION": if (inStartDay) metrics.exerciseCount!++; break;
      case "SUPPLEMENT": {
        const key = { AD: "supplementADCount", D3: "supplementD3Count", PROBIOTICS: "supplementProbioticsCount", PREBIOTICS: "supplementPrebioticsCount" }[activity.supplementType || "AD"];
        if (inStartDay && activity.supplementType && known("supplementType") && key) metrics[key]!++;
        break;
      }
      case "SPIT_UP": if (inStartDay) { metrics.spitUpCount!++; if (known("spitUpType") && activity.spitUpType === "PROJECTILE") metrics.projectileSpitUpCount!++; } break;
    }
  }
  return { metrics, coverage, byType };
}
