import { dateTimeLabel, durationMinutes, formatDuration, timeLabel } from "./date";
import type { Activity, ActivityType } from "./types";

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  SLEEP: "睡眠", DIAPER: "换尿布", BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶",
  HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐",
  GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外晒太阳", EARLY_EDUCATION: "早教",
  SUPPLEMENT: "补剂", SPIT_UP: "吐奶",
};
export const activityTypeLabel = (type: ActivityType): string => ACTIVITY_LABELS[type] || type;
export const SUPPLEMENT_LABELS = { AD: "AD", D3: "D3", PROBIOTICS: "益生菌", PREBIOTICS: "益生元" };
export const MILK_SOURCE_LABELS = { BREAST_MILK: "母乳", FORMULA: "奶粉" };
export const POOP_COLOR_LABELS = { YELLOW: "黄色", GREEN: "绿色", BROWN: "棕色", BLACK: "黑色", WHITE: "白色", RED: "红色" };
export const PEE_AMOUNT_LABELS = { SMALL: "少", MEDIUM: "中", LARGE: "多" };
export const BREAST_FIRMNESS_LABELS = { SOFT: "软", ELASTIC: "弹", HARD: "硬" };
export const SPIT_UP_LABELS = { NORMAL: "普通吐奶", PROJECTILE: "喷射性吐奶" };

export interface ActivityTone { color: string; background: string; border: string }
const tones: Record<string, ActivityTone> = {
  sky: { color: "#456f83", background: "#e5eff3", border: "#83a8b9" },
  rose: { color: "#945a5b", background: "#f8e7e5", border: "#d29c9a" },
  pink: { color: "#945a5b", background: "#f8e7e5", border: "#d29c9a" },
  fuchsia: { color: "#78618d", background: "#eee8f3", border: "#aa96bc" },
  yellow: { color: "#8b773d", background: "#f4efdd", border: "#c0aa6d" },
  amber: { color: "#8d7050", background: "#f3eadd", border: "#bd9d77" },
  orange: { color: "#966b50", background: "#f7e9dc", border: "#c7a183" },
  red: { color: "#a35e55", background: "#fae8e3", border: "#d49a90" },
  gray: { color: "#776f62", background: "#f0ede7", border: "#aba18f" },
};
export function activityTone(type: ActivityType): ActivityTone {
  const name = {
    SLEEP: "sky", BREASTFEED: "rose", BOTTLE: "pink", PUMP: "fuchsia", DIAPER: "yellow",
    HEAD_LIFT: "amber", PASSIVE_EXERCISE: "orange", GAS_EXERCISE: "amber", BATH: "yellow",
    OUTDOOR: "amber", EARLY_EDUCATION: "orange", ROLL_OVER: "amber", PULL_TO_SIT: "orange",
    SUPPLEMENT: "orange", SPIT_UP: "red",
  }[type];
  return tones[name] || tones.gray!;
}

export function activityLabel(activity: Activity): string {
  let label = activityTypeLabel(activity.type);
  if ((activity.type === "BOTTLE" || activity.type === "PUMP") && activity.milkAmount) return `${label} ${activity.milkAmount}ml`;
  if (activity.type === "DIAPER") {
    if (activity.hasPoop && activity.hasPee) return "大小便";
    if (activity.hasPoop) return "大便";
    if (activity.hasPee) return "小便";
    return label;
  }
  if (activity.type === "SUPPLEMENT" && activity.supplementType) return SUPPLEMENT_LABELS[activity.supplementType];
  if (activity.type === "SPIT_UP") return activity.spitUpType === "PROJECTILE" ? "喷射性吐奶" : "普通吐奶";
  const duration = activity.endTime ? durationMinutes(activity.startTime, activity.endTime) : 0;
  if (duration > 0) label += ` ${duration}分钟`;
  return label;
}

export interface DetailField { label: string; value: string }
export function activityDetails(activity: Activity): DetailField[] {
  const fields: DetailField[] = [{ label: "开始时间", value: dateTimeLabel(activity.startTime) }];
  if (activity.endTime) {
    fields.push({ label: "结束时间", value: dateTimeLabel(activity.endTime) });
    const minutes = durationMinutes(activity.startTime, activity.endTime);
    if (minutes > 0) fields.push({ label: "时长", value: formatDuration(minutes) });
  } else if (activity.type === "SLEEP") fields.push({ label: "状态", value: "正在睡觉…" });

  if (activity.type === "BOTTLE" || activity.type === "PUMP") {
    fields.push({ label: "奶量", value: activity.milkAmount ? `${activity.milkAmount} ml` : "未记录奶量" });
    if (activity.type === "BOTTLE" && activity.milkSource) fields.push({ label: "奶源", value: MILK_SOURCE_LABELS[activity.milkSource] });
  }
  if (activity.type === "BOTTLE" || activity.type === "BREASTFEED") {
    // Undefined and null both mean unknown; never present a missing value as failure.
    if (activity.burpSuccess != null) fields.push({ label: "拍嗝", value: activity.burpSuccess ? "成功" : "未成功" });
  }
  if (activity.type === "BREASTFEED" && activity.breastFirmness) fields.push({ label: "喂后乳房硬度", value: BREAST_FIRMNESS_LABELS[activity.breastFirmness] });
  if (activity.type === "DIAPER") {
    if (activity.hasPoop) fields.push({ label: "大便", value: activity.poopColor ? POOP_COLOR_LABELS[activity.poopColor] : "有" });
    if (activity.hasPee) fields.push({ label: "小便", value: activity.peeAmount ? PEE_AMOUNT_LABELS[activity.peeAmount] : "有" });
    if (!activity.hasPoop && !activity.hasPee) fields.push({ label: "尿布", value: "只换尿布" });
  }
  if (activity.type === "SUPPLEMENT") fields.push({ label: "补剂", value: activity.supplementType ? SUPPLEMENT_LABELS[activity.supplementType] : "未记录类型" });
  if (activity.type === "SPIT_UP") fields.push({ label: "吐奶类型", value: activity.spitUpType ? SPIT_UP_LABELS[activity.spitUpType] : "未记录类型" });
  if (activity.type === "ROLL_OVER" || activity.type === "PULL_TO_SIT") fields.push({ label: "次数", value: activity.count ? `${activity.count} 次` : "未记录次数" });
  if (activity.notes) fields.push({ label: "备注", value: activity.notes });
  if (activity.createdAt) fields.push({ label: "记录时间", value: dateTimeLabel(activity.createdAt) });
  if (activity.updatedAt) fields.push({ label: "更新时间", value: dateTimeLabel(activity.updatedAt) });
  return fields;
}

export const activityTimeRange = (activity: Activity): string => `${timeLabel(activity.startTime)}${activity.endTime ? ` - ${timeLabel(activity.endTime)}` : ""}`;
