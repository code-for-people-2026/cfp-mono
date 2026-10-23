import { dayBounds, durationInDay, durationMinutes, timestamp } from "./date";
import type { Activity, ActivityType, DateInput, DaySummary, SortField, StatFilter } from "./types";

export const FILTER_TYPES: Record<StatFilter, ActivityType[]> = {
  sleep: ["SLEEP"], bottle: ["BOTTLE"], breastfeed: ["BREASTFEED"], pump: ["PUMP"],
  diaper: ["DIAPER"], outdoor: ["OUTDOOR"], headLift: ["HEAD_LIFT"], rollOver: ["ROLL_OVER"],
};
export function filterActivities(activities: readonly Activity[], filters: readonly StatFilter[]): Activity[] {
  if (!filters.length) return [...activities];
  const allowed = new Set(filters.flatMap((filter) => FILTER_TYPES[filter]));
  return activities.filter((activity) => allowed.has(activity.type));
}
export function sortActivities(activities: readonly Activity[], field: SortField = "endTime"): Activity[] {
  const value = (activity: Activity) => field === "endTime" ? activity.endTime || activity.startTime : activity[field];
  return [...activities].sort((a, b) => timestamp(value(b) || 0) - timestamp(value(a) || 0));
}
function emptySummary(): DaySummary {
  return { sleepCount: 0, totalSleepMinutes: 0, totalBottleMilkAmount: 0, totalBreastfeedMinutes: 0,
    totalPumpMilkAmount: 0, diaperCount: 0, largePeeDiaperCount: 0, smallMediumPeeDiaperCount: 0,
    totalOutdoorMinutes: 0, totalHeadLiftMinutes: 0, totalRollOverCount: 0, totalPullToSitCount: 0 };
}

/** Home and record-list calculations deliberately retain their different legacy rules. */
function summarize(activities: readonly Activity[], date: DateInput, mode: "home" | "list"): DaySummary {
  const summary = emptySummary();
  const bounds = dayBounds(date);
  for (const activity of activities) {
    const start = timestamp(activity.startTime);
    if (activity.type === "SLEEP") {
      if (activity.endTime) {
        const minutes = durationInDay(activity.startTime, activity.endTime, date);
        if (minutes > 0) summary.sleepCount++;
        summary.totalSleepMinutes += minutes;
      }
      continue;
    }
    if (mode === "home" && (start < bounds.start || start > bounds.end)) continue;
    const minutes = activity.endTime
      ? durationMinutes(start, mode === "home" ? Math.min(timestamp(activity.endTime), bounds.end) : activity.endTime)
      : 0;
    switch (activity.type) {
      case "BOTTLE": summary.totalBottleMilkAmount += activity.milkAmount || 0; break;
      case "PUMP": summary.totalPumpMilkAmount += activity.milkAmount || 0; break;
      case "BREASTFEED": summary.totalBreastfeedMinutes += minutes; break;
      case "OUTDOOR": summary.totalOutdoorMinutes += minutes; break;
      case "HEAD_LIFT": summary.totalHeadLiftMinutes += minutes; break;
      case "DIAPER":
        summary.diaperCount++;
        if (activity.hasPee && activity.peeAmount === "LARGE") summary.largePeeDiaperCount++;
        if (activity.hasPee && (activity.peeAmount === "SMALL" || activity.peeAmount === "MEDIUM")) summary.smallMediumPeeDiaperCount++;
        break;
      case "ROLL_OVER": summary.totalRollOverCount += mode === "home" ? activity.count || 1 : activity.count ?? 1; break;
      case "PULL_TO_SIT": summary.totalPullToSitCount += mode === "home" ? activity.count || 1 : activity.count ?? 1; break;
    }
  }
  return summary;
}
export const summarizeHomeDay = (activities: readonly Activity[], date: DateInput): DaySummary => summarize(activities, date, "home");
export const summarizeRecordList = (activities: readonly Activity[], date: DateInput): DaySummary => summarize(activities, date, "list");
export function statCards(summary: DaySummary): Array<{ key: StatFilter; label: string; value: string; color: string }> {
  return [
    { key: "sleep", label: "睡", value: `${Math.floor(summary.totalSleepMinutes / 60)}:${String(summary.totalSleepMinutes % 60).padStart(2, "0")}`, color: "#456f83" },
    { key: "bottle", label: "瓶", value: `${summary.totalBottleMilkAmount} ml`, color: "#945a5b" },
    { key: "breastfeed", label: "亲", value: `${summary.totalBreastfeedMinutes} min`, color: "#945a5b" },
    { key: "pump", label: "吸", value: `${summary.totalPumpMilkAmount} ml`, color: "#78618d" },
    { key: "diaper", label: "尿", value: `${summary.largePeeDiaperCount + Math.ceil(summary.smallMediumPeeDiaperCount / 2)} 次`, color: "#8b773d" },
    { key: "outdoor", label: "阳", value: `${summary.totalOutdoorMinutes} min`, color: "#8d7050" },
    { key: "headLift", label: "趴", value: `${summary.totalHeadLiftMinutes} min`, color: "#966b50" },
    { key: "rollOver", label: "翻", value: `${summary.totalRollOverCount} 次`, color: "#966b50" },
  ];
}
