import type { Activity, RecordCoverage, RecordEvent, RecordSummary, RecordSyncStatus, RecordTypeSummary, StatFilter } from "./types";
import { activityDetails, type DetailField } from "./presentation";
import { dateTimeLabel } from "./date";

export function coverageMessage(coverage?: RecordCoverage): string {
  if (!coverage) return "";
  const parts: string[] = [];
  if (!coverage.recordedEvents) parts.push("暂无可计入记录");
  if (coverage.incompleteEvents) parts.push(`${coverage.incompleteEvents} 条信息待补充`);
  if (coverage.unknownFields) parts.push(`${coverage.unknownFields} 项明确未知`);
  else if (coverage.unknownMilkAmounts) parts.push(`${coverage.unknownMilkAmounts} 次奶量未知`);
  if (coverage.ongoingEvents) parts.push(`${coverage.ongoingEvents} 条进行中，未计入完成时长`);
  if (coverage.duplicateCandidates) parts.push(`${coverage.duplicateCandidates} 条疑似重复待核对，暂不重复计入`);
  if (coverage.pendingCandidates > coverage.duplicateCandidates) parts.push(`${coverage.pendingCandidates - coverage.duplicateCandidates} 条待确认保存`);
  if (coverage.unresolvedTime) parts.push(`${coverage.unresolvedTime} 条发生时间待确认`);
  return parts.join("；");
}

/** Sidecar cards consume the same server projection used by query tools and trends. */
export function recordStatCards(summary: RecordSummary): Array<{ key: StatFilter; label: string; value: string; color: string }> {
  const metric = (key: string) => summary.metrics[key] ?? 0;
  const row = (type: string) => summary.byType[type];
  const duration = (type: string, value: number, sleep = false) => {
    const detail = row(type);
    if (!detail?.events) return "暂无";
    if (!detail.knownDurations) return detail.ongoingEvents ? "进行中" : "待补全";
    return sleep ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}` : `${value} min`;
  };
  const milk = (type: string, value: number) => {
    const detail = row(type);
    if (!detail?.events) return "暂无";
    if (detail.knownMilkAmounts) return `${value} ml`;
    return detail.ongoingEvents === detail.events ? "进行中" : "待补全";
  };
  const roll = row("ROLL_OVER");
  return [
    { key: "sleep", label: "睡", value: duration("SLEEP", metric("totalSleepMinutes"), true), color: "#456f83" },
    { key: "bottle", label: "瓶", value: milk("BOTTLE", metric("totalMilkAmount")), color: "#945a5b" },
    { key: "breastfeed", label: "亲", value: duration("BREASTFEED", metric("totalBreastfeedMinutes")), color: "#945a5b" },
    { key: "pump", label: "吸", value: milk("PUMP", metric("totalPumpMilkAmount")), color: "#78618d" },
    { key: "diaper", label: "尿布", value: row("DIAPER")?.events ? `${metric("diaperCount")} 次` : "暂无", color: "#8b773d" },
    { key: "outdoor", label: "阳", value: duration("OUTDOOR", row("OUTDOOR")?.knownMinutes || 0), color: "#8d7050" },
    { key: "headLift", label: "趴", value: duration("HEAD_LIFT", metric("totalHeadLiftMinutes")), color: "#966b50" },
    { key: "rollOver", label: "翻", value: !roll?.events ? "暂无" : roll.unknownCount === roll.events ? "待补全" : `${roll.knownCount} 次`, color: "#966b50" },
  ];
}

export function hasMetricFacts(byType: Record<string, RecordTypeSummary> | undefined, metric: "sleep" | "milk" | "pump" | "diapers"): boolean | undefined {
  if (!byType) return undefined;
  const row = byType[{ sleep: "SLEEP", milk: "BOTTLE", pump: "PUMP", diapers: "DIAPER" }[metric]];
  if (!row) return false;
  return metric === "sleep" ? row.knownDurations > 0 : metric === "diapers" ? row.events > 0 : row.knownMilkAmounts > 0;
}

const fieldLabels: Record<string, string> = { type: "活动类型", startTime: "开始时间", endTime: "结束时间", durationMinutes: "时长", milkAmount: "实际奶量",
  milkSource: "奶源", preparedMilkAmount: "泡好奶量", remainingMilkAmount: "剩余奶量", sameBottle: "是否同一瓶", burpSuccess: "拍嗝结果",
  breastFirmness: "乳房硬度", hasPoop: "是否有便", hasPee: "是否有尿", poopColor: "大便颜色", peeAmount: "尿量", count: "次数", supplementType: "补剂类型", spitUpType: "吐奶类型" };
export function recordDetailFields(activity: Activity, event: RecordEvent): DetailField[] {
  const fields = activityDetails(activity).filter(field => field.label !== "状态");
  if (activity.milkAmount === 0) { const milk = fields.find(field => field.label === "奶量"); if (milk) milk.value = "0 ml"; }
  if (activity.count === 0) { const count = fields.find(field => field.label === "次数"); if (count) count.value = "0 次"; }
  const hasCurrentValue = (field: string) => {
    if (field === "durationMinutes") return !!activity.endTime;
    return (activity as unknown as Record<string, unknown>)[field] != null;
  };
  const labels = (keys: string[]) => [...new Set(keys.filter(field => !hasCurrentValue(field)).map(field => fieldLabels[field]).filter(Boolean))].join("、");
  const unfinishedOutcomes = Object.keys(event.states).filter(field => event.states[field] === "not_yet");
  const pending = labels([...event.missing, ...(event.currentProgress === "ended" ? unfinishedOutcomes.filter(field => field === "milkAmount" || field === "burpSuccess") : [])]);
  const unknown = labels(Object.keys(event.states).filter(field => event.states[field] === "unknown"));
  const notYet = event.currentProgress === "ongoing" ? labels(unfinishedOutcomes) : "";
  fields.push({ label: "记录版本", value: `第 ${event.version} 版` });
  fields.push({ label: "保存状态", value: event.projection === "synced" ? "已保存" : event.projection === "pending" ? "等待同步保存" : "待核对，已保存事实保留" });
  if (!activity.endTime) fields.push({ label: "活动状态", value: event.currentProgress === "ongoing" && event.projection === "synced" ? "进行中，完成时长待结束后确认" : "结束时间尚未确定" });
  const sources = [...new Set(event.sources.map(source => ({ chat: "对话录入", wechat: "微信群记录", manual: "手动记录" }[source.kind])))];
  fields.push({ label: "记录来源", value: sources.join("、") || "原有记录" });
  if (event.sources.length) fields.push({ label: "来源时间", value: dateTimeLabel([...event.sources].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))[0]!.sentAt) });
  if (pending) fields.push({ label: "待补充", value: pending });
  if (unknown) fields.push({ label: "明确未知", value: unknown });
  if (notYet) fields.push({ label: "尚未发生", value: notYet });
  if (event.conflicts.length) fields.push({ label: "待核对", value: "部分信息存在冲突，等待核对" });
  return fields;
}

export function syncStatusLines(jobs: readonly RecordSyncStatus[]): string[] {
  if (!jobs.length) return ["尚未配置群同步"];
  const lines: string[] = [];
  const successes = jobs.flatMap(job => job.lastSuccessAt ? [job.lastSuccessAt] : []).sort();
  lines.push(successes.length ? `最近同步成功 ${dateTimeLabel(successes[successes.length - 1]!)}` : "尚无成功同步记录");
  const through = jobs.flatMap(job => job.processedThrough ? [job.processedThrough] : []).sort();
  if (through.length) lines.push(`消息处理至 ${dateTimeLabel(through[0]!)}${through.length < jobs.length ? "（部分来源）" : ""}`);
  const pending = jobs.filter(job => job.pending).length;
  const media = jobs.reduce((total, job) => total + job.pendingMedia, 0);
  if (pending) lines.push(`${pending} 项同步处理中`);
  if (media) lines.push(`${media} 项媒体待补取`);
  if (jobs.some(job => job.failure)) lines.push("最近同步失败，当前显示已保存记录；稍后刷新查看进度");
  else if (!jobs.some(job => job.enabled)) lines.push("自动采集未启用");
  return lines;
}
