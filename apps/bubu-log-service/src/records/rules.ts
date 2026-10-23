import { activityTypes, type Evidence, type Facts, type Field, type FieldState, type RuleInput, type RuleIssue, type RuleResult } from "./types";

const pointTypes = new Set(["DIAPER", "SUPPLEMENT", "SPIT_UP", "ROLL_OVER", "PULL_TO_SIT"]);
const durationTypes = new Set(activityTypes.filter(type => !pointTypes.has(type)));
const common: Field[] = ["type", "startTime", "notes"];
const feeding: Field[] = ["endTime", "durationMinutes", "burpSuccess"];
const applicable: Record<string, Field[]> = {
  BREASTFEED: [...feeding, "breastFirmness"],
  BOTTLE: [...feeding, "milkSource", "milkAmount", "preparedMilkAmount", "remainingMilkAmount", "sameBottle"],
  PUMP: ["endTime", "durationMinutes", "milkAmount"], SLEEP: ["endTime", "durationMinutes"],
  DIAPER: ["hasPoop", "hasPee", "peeAmount", "poopColor", "poopPhotoUrl"],
  HEAD_LIFT: ["endTime", "durationMinutes"], PASSIVE_EXERCISE: ["endTime", "durationMinutes"],
  GAS_EXERCISE: ["endTime", "durationMinutes"], BATH: ["endTime", "durationMinutes"],
  OUTDOOR: ["endTime", "durationMinutes"], EARLY_EDUCATION: ["endTime", "durationMinutes"],
  ROLL_OVER: ["count"], PULL_TO_SIT: ["count"], SUPPLEMENT: ["supplementType"], SPIT_UP: ["spitUpType"],
};
const allFields: Field[] = [...new Set([...common, ...Object.values(applicable).flat()])];
const numeric: Field[] = ["milkAmount", "preparedMilkAmount", "remainingMilkAmount", "durationMinutes", "count"];
const enums: Partial<Record<Field, readonly string[]>> = {
  type: activityTypes, milkSource: ["BREAST_MILK", "FORMULA"], breastFirmness: ["SOFT", "ELASTIC", "HARD"],
  peeAmount: ["SMALL", "MEDIUM", "LARGE"], poopColor: ["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"],
  supplementType: ["AD", "D3", "PROBIOTICS", "PREBIOTICS"], spitUpType: ["NORMAL", "PROJECTILE"],
};
const present = (value: unknown) => value !== undefined && value !== null && value !== "";
function timed(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() + 1 === month && calendar.getUTCDate() === day && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6] || 0) < 60;
}

/** Facts are normalized without the old forms' remembered preferences or invented defaults. */
export function evaluateEvent(input: RuleInput, options: { now?: number } = {}): RuleResult {
  const facts: Facts = { ...input.facts };
  const states: Partial<Record<Field, FieldState>> = { ...input.states };
  const evidence: Evidence[] = (input.evidence || []).map(item => ({ ...item }));
  const conflicts: RuleIssue[] = [];
  const issue = (code: string, fields: Field[], message: string) => conflicts.push({ code, fields, message });
  for (const field of allFields) {
    if (states[field] && states[field] !== "known") delete facts[field];
    if (present(facts[field])) states[field] = "known";
    else if (states[field] === "known") { states[field] = "pending"; issue("MISSING_KNOWN_VALUE", [field], "已知字段需要提供实际值"); }
  }
  for (const item of evidence) {
    if (item.kind === "image" && !item.confirmed && !evidence.some(other => other.field === item.field && other.confirmed)) {
      delete facts[item.field]; states[item.field] = "pending";
    }
  }
  for (const field of numeric) {
    const value = facts[field];
    if (present(value) && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (field === "count" && !Number.isSafeInteger(value)))) {
      issue("INVALID_NUMBER", [field], field === "count" ? "次数必须是非负整数" : "数值必须是有限的非负数，请核对单位");
    }
  }
  for (const [name, choices] of Object.entries(enums)) {
    const field = name as Field;
    if (present(facts[field]) && !choices.includes(facts[field] as string)) issue("INVALID_ENUM", [field], "该字段不在支持的选项内");
  }
  for (const field of ["hasPoop", "hasPee", "burpSuccess", "sameBottle"] as const) {
    if (present(facts[field]) && typeof facts[field] !== "boolean") issue("INVALID_BOOLEAN", [field], "请明确是、否或未知");
  }
  const now = options.now ?? Date.now();
  for (const field of ["startTime", "endTime"] as const) {
    if (!present(facts[field])) continue;
    if (!timed(facts[field])) issue("INVALID_TIME", [field], "时间需要有效的日期、时刻和时区");
    else {
      facts[field] = new Date(facts[field]).toISOString();
      if (Date.parse(facts[field]) > now + 120_000) issue("FUTURE_TIME", [field], "发生时间不能在未来，请核对原消息时间和时区");
    }
  }
  if (present(facts.notes) && (typeof facts.notes !== "string" || facts.notes.length > 10_000)) issue("INVALID_NOTES", ["notes"], "备注应为不超过10000字的文本");
  const type = facts.type;
  const allowed = new Set([...common, ...(type ? applicable[type] || [] : [])]);
  // Until the activity is identified, preserve partial evidence for later branch selection.
  if (type && applicable[type]) for (const field of allFields) if (!allowed.has(field)) { delete facts[field]; states[field] = "not_applicable"; }
  const notApplicable = (field: Field) => { delete facts[field]; states[field] = "not_applicable"; };
  const requireField = (field: Field, required: Field[]) => {
    if (!present(facts[field]) && (!states[field] || states[field] === "not_applicable" || states[field] === "not_yet")) states[field] = "pending";
    required.push(field);
  };
  const required: Field[] = [];
  requireField("type", required); requireField("startTime", required);
  let progress = input.progress ?? (present(facts.endTime) || present(facts.durationMinutes) || (type && pointTypes.has(type)) ? "ended" : "unknown");
  if (type && pointTypes.has(type)) {
    progress = "ended";
    if (timed(facts.startTime)) { facts.endTime = facts.startTime; states.endTime = "known"; }
  } else if (type && durationTypes.has(type)) {
    if (progress === "ongoing") {
      if (present(facts.endTime)) issue("ONGOING_HAS_END", ["endTime"], "进行中与已经结束的时间矛盾，请确认事件状态");
      if (!present(facts.endTime)) states.endTime = "not_yet";
      if (!present(facts.durationMinutes)) states.durationMinutes = "not_yet";
    } else {
      if (timed(facts.startTime) && typeof facts.durationMinutes === "number" && facts.durationMinutes >= 0 && Number.isFinite(facts.durationMinutes) && !present(facts.endTime)) {
        const end = Date.parse(facts.startTime) + facts.durationMinutes * 60_000;
        if (Number.isFinite(end) && Math.abs(end) <= 8.64e15) {
          facts.endTime = new Date(end).toISOString(); states.endTime = "known";
          evidence.push({ field: "endTime", kind: "calculated", detail: "startTime + durationMinutes", confirmed: true });
          if (end > now + 120_000) issue("FUTURE_TIME", ["startTime", "durationMinutes"], "推导出的结束时间在未来");
        } else issue("INVALID_DURATION", ["durationMinutes"], "时长无法转换成有效时间");
      }
      if (timed(facts.startTime) && timed(facts.endTime)) {
        const duration = (Date.parse(facts.endTime) - Date.parse(facts.startTime)) / 60_000;
        if (duration < 0) issue("END_BEFORE_START", ["startTime", "endTime"], "结束时间不能早于开始时间；跨夜请注明日期");
        else if (typeof facts.durationMinutes === "number" && Math.abs(facts.durationMinutes - duration) > 1 / 60) issue("DURATION_MISMATCH", ["startTime", "endTime", "durationMinutes"], "起止时间与时长不一致");
        else { facts.durationMinutes = duration; states.durationMinutes = "known"; progress = "ended"; }
      }
      if (!present(facts.endTime) && !present(facts.durationMinutes)) {
        if (states.durationMinutes === "unknown" && !states.endTime) states.endTime = "unknown";
        requireField("endTime", required);
      }
      else required.push(present(facts.endTime) ? "endTime" : "durationMinutes");
    }
  }
  // Outcomes are only due once an activity ends. Preserve any explicitly reported
  // value or unknown answer, but do not ask for a final amount or burp in progress.
  const requireOutcome = (field: Field) => {
    if (progress === "ongoing" && !present(facts[field])) {
      if (states[field] !== "unknown") states[field] = "not_yet";
      return;
    }
    requireField(field, required);
  };
  if (type === "BREASTFEED") { requireOutcome("burpSuccess"); requireField("breastFirmness", required); }
  if (type === "BOTTLE") {
    requireField("milkSource", required); requireOutcome("milkAmount"); requireOutcome("burpSuccess");
    if (facts.milkSource === "BREAST_MILK") for (const field of ["preparedMilkAmount", "remainingMilkAmount", "sameBottle"] as const) notApplicable(field);
    if (facts.milkSource === "FORMULA") {
      requireField("preparedMilkAmount", required);
      if (progress === "ongoing" && !present(facts.remainingMilkAmount) && states.remainingMilkAmount !== "unknown") states.remainingMilkAmount = "not_yet";
      const prepared = facts.preparedMilkAmount; const remaining = facts.remainingMilkAmount; const consumed = facts.milkAmount;
      if (typeof prepared === "number" && typeof remaining === "number") {
        if (remaining > prepared) issue("REMAINDER_EXCEEDS_PREPARED", ["preparedMilkAmount", "remainingMilkAmount"], "剩余量不能超过同一瓶的泡好量");
        else if (facts.sameBottle === true) {
          const derived = Math.round((prepared - remaining) * 1e9) / 1e9;
          if (typeof consumed === "number" && Math.abs(consumed - derived) > 1e-6) issue("MILK_AMOUNT_MISMATCH", ["milkAmount", "preparedMilkAmount", "remainingMilkAmount"], "实际喝入量与同一瓶的泡好量减剩余量不一致");
          else if (!present(consumed)) {
            facts.milkAmount = derived; states.milkAmount = "known";
            evidence.push({ field: "milkAmount", kind: "calculated", detail: `${prepared} ml prepared - ${remaining} ml remaining; sameBottle=true`, confirmed: true });
          }
        } else if (!present(consumed) && progress !== "ongoing") requireField("sameBottle", required);
      }
      if (typeof prepared === "number" && typeof facts.milkAmount === "number" && facts.milkAmount > prepared) issue("CONSUMED_EXCEEDS_PREPARED", ["milkAmount", "preparedMilkAmount"], "实际喝入量超过泡好量，请核对是否同一瓶");
    }
  }
  if (type === "PUMP") requireOutcome("milkAmount");
  if (type === "DIAPER") {
    requireField("hasPoop", required); requireField("hasPee", required);
    if (facts.hasPoop === true) requireField("poopColor", required);
    else if (facts.hasPoop === false) { notApplicable("poopColor"); notApplicable("poopPhotoUrl"); }
    if (facts.hasPee === true) requireField("peeAmount", required);
    else if (facts.hasPee === false) notApplicable("peeAmount");
    if (facts.hasPoop === false && facts.hasPee === false) issue("EMPTY_DIAPER", ["hasPoop", "hasPee"], "已明确无尿无便，请核对是否需要保存本次换尿布");
  }
  if (type === "ROLL_OVER" || type === "PULL_TO_SIT") requireField("count", required);
  if (type === "SUPPLEMENT") requireField("supplementType", required);
  if (type === "SPIT_UP") requireField("spitUpType", required);
  const missing = [...new Set(required.filter(field => states[field] === "pending"))];
  const uniqueEvidence = [...new Map(evidence.map(item => [JSON.stringify(item), item])).values()];
  return { facts, states, progress, missing, conflicts, complete: !conflicts.length && required.every(field => states[field] === "known"), evidence: uniqueEvidence };
}

/** Overlap is a clarification signal; it never merges or deletes distinct facts. */
export function timeConflicts(facts: Facts, other: Facts): RuleIssue[] {
  if (!facts.type || !other.type || !timed(facts.startTime) || !timed(other.startTime)) return [];
  const aStart = Date.parse(facts.startTime); const bStart = Date.parse(other.startTime);
  const aEnd = timed(facts.endTime) ? Date.parse(facts.endTime) : aStart;
  const bEnd = timed(other.endTime) ? Date.parse(other.endTime) : bStart;
  const overlaps = aStart === bStart || (aStart < bEnd && bStart < aEnd);
  if (!overlaps) return [];
  const feeds = new Set(["BREASTFEED", "BOTTLE"]);
  const awake = new Set(["HEAD_LIFT", "PASSIVE_EXERCISE", "ROLL_OVER", "PULL_TO_SIT", "GAS_EXERCISE", "BATH", "EARLY_EDUCATION"]);
  if ((facts.type === other.type && durationTypes.has(facts.type)) || (feeds.has(facts.type) && feeds.has(other.type)) || (facts.type === "SLEEP" && awake.has(other.type)) || (other.type === "SLEEP" && awake.has(facts.type))) {
    return [{ code: "TIME_OVERLAP", fields: ["startTime", "endTime"], message: "与已有活动时间重叠，请核对记录或确认实际情况" }];
  }
  return [];
}
