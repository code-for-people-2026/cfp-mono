import { activityTypes, type Evidence, type Facts, type Field, type FieldState, type MilkItem, type RuleInput, type RuleIssue, type RuleResult } from "./types";

const pointTypes = new Set(["DIAPER", "SUPPLEMENT", "SPIT_UP", "ROLL_OVER", "PULL_TO_SIT"]);
export const durationRequiredTypes = new Set(["BREASTFEED", "SLEEP", "HEAD_LIFT", "OUTDOOR"]);
export const completionTimeAliasDetail = "single completion timestamp stored as event time";
const common: Field[] = ["type", "startTime", "notes"];
const feeding: Field[] = ["endTime", "durationMinutes", "burpSuccess"];
const applicable: Record<string, Field[]> = {
  BREASTFEED: [...feeding, "reportedIntake", "milkAmount", "breastFirmness"],
  BOTTLE: [...feeding, "milkItems", "milkSource", "milkDescription", "milkAmount", "preparedMilkAmount", "remainingMilkAmount", "sameBottle"],
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
const hasOwn = (value: object, field: PropertyKey) => Object.prototype.hasOwnProperty.call(value, field);
const validReportedIntake = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const intake = value as Record<string, unknown>;
  const keys = new Set(Object.keys(intake));
  if (keys.size !== 3 || !["value", "unit", "originalText"].every(key => keys.has(key))) return false;
  return typeof intake.value === "number" && Number.isFinite(intake.value) && intake.value >= 0 && intake.value <= 100000 &&
    intake.unit === "g" && typeof intake.originalText === "string" && intake.originalText.length <= 4000 && intake.originalText.trim().length > 0;
};
function timed(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const calendar = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() + 1 === month && calendar.getUTCDate() === day && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6] || 0) < 60;
}

export function isCompletionTimeAlias(facts: Facts, evidence: Evidence[]): boolean {
  return facts.startTime === facts.endTime && evidence.some(item => item.field === "startTime" && item.kind === "calculated" && item.detail === completionTimeAliasDetail);
}

/** Normalize care facts without applying remembered UI preferences. */
export function evaluateEvent(input: RuleInput, options: { now?: number } = {}): RuleResult {
  const facts: Facts = { ...input.facts };
  const states: Partial<Record<Field, FieldState>> = { ...input.states };
  const evidence: Evidence[] = (input.evidence || []).map(item => ({ ...item }));
  const conflicts: RuleIssue[] = [];
  const issue = (code: string, fields: Field[], message: string) => conflicts.push({ code, fields, message });
  const removeEvidence = (field: Field, kind?: Evidence["kind"]) => {
    for (let index = evidence.length - 1; index >= 0; index--) {
      const item = evidence[index];
      if (item?.field === field && (!kind || item.kind === kind)) evidence.splice(index, 1);
    }
  };
  const uncertainImage = (field: Field) => evidence.some(item => item.field === field && item.kind === "image" && !item.confirmed);
  const explicitEvidence = (field: Field) => evidence.some(item => item.field === field && item.kind !== "default");
  const businessDefaults: Partial<Record<Field, unknown>> = { hasPee: true, hasPoop: false, peeAmount: "LARGE", spitUpType: "NORMAL" };
  for (const [name, value] of Object.entries(businessDefaults)) {
    const field = name as Field;
    if ((present(input.facts[field]) && input.facts[field] !== value) || input.states?.[field] === "unknown" || uncertainImage(field) || explicitEvidence(field)) {
      removeEvidence(field, "default");
    }
  }

  const bottleItemAuthority = input.facts.type === "BOTTLE" && Array.isArray(input.facts.milkItems) && input.facts.milkItems.length > 0;
  for (const field of allFields) {
    // These are virtual bottle aggregates. The item array is authoritative, so a
    // normalized event legitimately has state=known without a root source fact.
    if (bottleItemAuthority && (field === "milkAmount" || field === "milkSource" || field === "milkDescription")) continue;
    if (states[field] && states[field] !== "known") delete facts[field];
    if (present(facts[field])) states[field] = "known";
    else if (states[field] === "known") { states[field] = "pending"; issue("MISSING_KNOWN_VALUE", [field], "已知字段需要提供实际值"); }
  }
  for (const item of [...evidence]) {
    if (item.kind === "image" && !item.confirmed && !evidence.some(other => other.field === item.field && other.confirmed && other.kind !== "default")) {
      delete facts[item.field]; states[item.field] = "pending"; removeEvidence(item.field, "default");
    }
  }
  if (!present(facts.burpSuccess) && states.burpSuccess === "not_yet") delete states.burpSuccess;

  for (const field of numeric) {
    const value = facts[field];
    if (present(value) && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (field === "count" && !Number.isSafeInteger(value)))) {
      issue("INVALID_NUMBER", [field], field === "count" ? "次数必须是非负整数" : "数值必须是有限的非负数，请核对单位");
    }
  }
  if (facts.reportedIntake !== undefined && facts.reportedIntake !== null && !validReportedIntake(facts.reportedIntake)) issue("INVALID_REPORTED_INTAKE", ["reportedIntake"], "报告摄入量必须是0到100000克的明确对象，并保留非空原话");
  for (const [name, choices] of Object.entries(enums)) {
    const field = name as Field;
    if (present(facts[field]) && !choices.includes(facts[field] as string)) issue("INVALID_ENUM", [field], "该字段不在支持的选项内");
  }
  for (const field of ["hasPoop", "hasPee", "burpSuccess", "sameBottle"] as const) if (present(facts[field]) && typeof facts[field] !== "boolean") issue("INVALID_BOOLEAN", [field], "请明确是、否或未知");

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
  if (present(facts.milkDescription) && (typeof facts.milkDescription !== "string" || !facts.milkDescription.trim() || facts.milkDescription.length > 100)) {
    issue("INVALID_MILK_DESCRIPTION", ["milkDescription"], "奶品原话应为不超过100字的非空文本");
  } else if (typeof facts.milkDescription === "string") facts.milkDescription = facts.milkDescription.trim();

  const type = facts.type;
  const allowed = new Set([...common, ...(type ? applicable[type] || [] : [])]);
  if (type && applicable[type]) for (const field of allFields) if (!allowed.has(field)) { delete facts[field]; states[field] = "not_applicable"; removeEvidence(field, "default"); }
  const notApplicable = (field: Field) => { delete facts[field]; states[field] = "not_applicable"; removeEvidence(field, "default"); };
  const required: Field[] = [];
  const requireField = (field: Field, markPending = true) => {
    if (markPending && !present(facts[field]) && (!states[field] || states[field] === "not_applicable" || states[field] === "not_yet")) states[field] = "pending";
    required.push(field);
  };
  requireField("type");

  let progress = input.progress ?? (type && pointTypes.has(type) ? "ended" : present(facts.endTime) || present(facts.durationMinutes) ? "ended" : "unknown");
  if (type && pointTypes.has(type)) progress = "ended";
  const completionAlias = isCompletionTimeAlias(facts, evidence);

  // Every valid pair of start/end/duration determines the third. Ongoing events
  // never synthesize a future outcome from an elapsed duration.
  if (progress !== "ongoing") {
    const duration = facts.durationMinutes;
    if (!timed(facts.startTime) && timed(facts.endTime) && typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
      const start = Date.parse(facts.endTime) - duration * 60_000;
      if (Number.isFinite(start) && Math.abs(start) <= 8.64e15) {
        facts.startTime = new Date(start).toISOString(); states.startTime = "known";
        evidence.push({ field: "startTime", kind: "calculated", detail: "endTime - durationMinutes", confirmed: true });
      } else issue("INVALID_DURATION", ["durationMinutes"], "时长无法转换成有效时间");
    }
    if (timed(facts.startTime) && !timed(facts.endTime) && typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
      const end = Date.parse(facts.startTime) + duration * 60_000;
      if (Number.isFinite(end) && Math.abs(end) <= 8.64e15) {
        facts.endTime = new Date(end).toISOString(); states.endTime = "known";
        evidence.push({ field: "endTime", kind: "calculated", detail: "startTime + durationMinutes", confirmed: true });
        if (end > now + 120_000) issue("FUTURE_TIME", ["startTime", "durationMinutes"], "推导出的结束时间在未来");
      } else issue("INVALID_DURATION", ["durationMinutes"], "时长无法转换成有效时间");
    }
    if (timed(facts.startTime) && timed(facts.endTime) && (!completionAlias || duration !== undefined)) {
      const calculated = (Date.parse(facts.endTime) - Date.parse(facts.startTime)) / 60_000;
      if (calculated < 0) issue("END_BEFORE_START", ["startTime", "endTime"], "结束时间不能早于开始时间；跨夜请注明日期");
      else if (typeof duration === "number" && Math.abs(duration - calculated) > 1 / 60) issue("DURATION_MISMATCH", ["startTime", "endTime", "durationMinutes"], "起止时间与时长不一致");
      else {
        facts.durationMinutes = calculated; states.durationMinutes = "known"; progress = "ended";
        if (duration === undefined) evidence.push({ field: "durationMinutes", kind: "calculated", detail: "endTime - startTime", confirmed: true });
      }
    }
  } else {
    if (present(facts.endTime)) issue("ONGOING_HAS_END", ["endTime"], "进行中与已经结束的时间矛盾，请确认事件状态");
    if (!present(facts.endTime)) states.endTime = "not_yet";
    if (!present(facts.durationMinutes)) states.durationMinutes = "not_yet";
  }

  if (type && !durationRequiredTypes.has(type) && timed(facts.endTime) && !timed(facts.startTime) && !present(facts.durationMinutes)) {
    facts.startTime = facts.endTime; states.startTime = "known";
    evidence.push({ field: "startTime", kind: "calculated", detail: completionTimeAliasDetail, confirmed: true });
  }

  if (type && durationRequiredTypes.has(type)) {
    if (progress === "ongoing") requireField("startTime");
    else {
      for (const field of ["startTime", "endTime", "durationMinutes"] as const) required.push(field);
      const known = ["startTime", "endTime", "durationMinutes"].filter(field => present(facts[field as Field]));
      const explicitlyUnknown = ["startTime", "endTime", "durationMinutes"].some(field => states[field as Field] === "unknown");
      if (known.length < 2 && !explicitlyUnknown) {
        const question: Field = known.length === 0 ? "startTime" : known[0] === "endTime" ? "durationMinutes" : "endTime";
        if (!states[question] || states[question] === "not_applicable" || states[question] === "not_yet") states[question] = "pending";
      }
    }
  } else requireField("startTime");

  const requireOutcome = (field: Field) => {
    if (progress === "ongoing" && !present(facts[field])) {
      if (states[field] !== "unknown") states[field] = "not_yet";
      return;
    }
    requireField(field);
  };
  if (type === "BOTTLE") {
    requireField("milkItems");
    const suppliedItems = Array.isArray(facts.milkItems) ? facts.milkItems : [];
    if (!suppliedItems.length) {
      states.milkItems = "pending"; states.milkSource = "pending"; states.milkAmount = "pending";
      required.push("milkSource", "milkAmount");
      delete facts.milkAmount; delete facts.milkSource; delete facts.milkDescription;
    } else {
      const ids = new Set<string>();
      const items: MilkItem[] = suppliedItems.map((raw, index) => {
        const item = { ...raw };
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          issue("INVALID_MILK_ITEM", ["milkItems"], `第 ${index + 1} 个奶品明细格式无效`);
          return { id: `invalid-${index}`, milkSourceState: "pending", milkAmountState: "pending" };
        }
        if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 200) issue("INVALID_MILK_ITEM_ID", ["milkItems"], "奶品明细需要稳定且有效的 ID");
        else if (ids.has(item.id)) issue("DUPLICATE_MILK_ITEM_ID", ["milkItems"], "同一餐的奶品明细 ID 不能重复");
        else ids.add(item.id);
        if (item.milkSource !== undefined && !["BREAST_MILK", "FORMULA"].includes(item.milkSource)) issue("INVALID_MILK_ITEM_SOURCE", ["milkItems"], "奶品明细的标准奶源无效");
        if (item.milkSource !== undefined && item.milkDescription !== undefined) issue("AMBIGUOUS_MILK_ITEM_SOURCE", ["milkItems"], "一个奶品明细不能同时使用标准奶源和原话奶品");
        if (item.milkDescription !== undefined) {
          if (typeof item.milkDescription !== "string" || !item.milkDescription.trim() || item.milkDescription.length > 100) issue("INVALID_MILK_ITEM_DESCRIPTION", ["milkItems"], "奶品明细原话应为不超过100字的非空文本");
          else item.milkDescription = item.milkDescription.trim();
        }
        const hasSource = !!item.milkSource || !!item.milkDescription;
        if (hasSource) item.milkSourceState = "known";
        else if (item.milkSourceState === "known") { item.milkSourceState = "pending"; issue("MISSING_MILK_ITEM_SOURCE", ["milkSource"], "已知奶品必须提供标准奶源或原话奶品"); }
        else if (item.milkSourceState !== "unknown") item.milkSourceState = "pending";
        if (typeof item.milkAmount === "number" && Number.isFinite(item.milkAmount) && item.milkAmount >= 0 && item.milkAmount <= 100000) item.milkAmountState = "known";
        else if (item.milkAmount !== undefined && item.milkAmount !== null) issue("INVALID_MILK_ITEM_AMOUNT", ["milkAmount"], "每项实际喝入量必须是有限的非负数");
        else if (item.milkAmountState === "known") { item.milkAmountState = "pending"; issue("MISSING_MILK_ITEM_AMOUNT", ["milkAmount"], "已知奶量必须提供实际喝入量"); }
        else if (item.milkAmountState !== "unknown") item.milkAmountState = "pending";
        if (item.milkAmountState !== "known") delete item.milkAmount;
        return item;
      });
      const prepared = facts.preparedMilkAmount; const remaining = facts.remainingMilkAmount;
      if (items.length === 1 && typeof prepared === "number" && typeof remaining === "number" && remaining <= prepared && facts.sameBottle === true && items[0]!.milkAmountState === "pending") {
        items[0]!.milkAmount = Math.round((prepared - remaining) * 1e9) / 1e9;
        items[0]!.milkAmountState = "known";
      }
      facts.milkItems = items;
      states.milkItems = "known";
      const sourceStates = items.map(item => item.milkSourceState);
      const amountStates = items.map(item => item.milkAmountState);
      states.milkSource = sourceStates.every(state => state === "known") ? "known" : sourceStates.some(state => state === "pending") ? "pending" : "unknown";
      states.milkAmount = amountStates.every(state => state === "known") ? "known" : amountStates.some(state => state === "pending") ? "pending" : "unknown";
      required.push("milkSource", "milkAmount");
      delete facts.milkSource; delete facts.milkDescription;
      removeEvidence("milkAmount", "calculated");
      if (states.milkAmount === "known") {
        facts.milkAmount = Math.round(items.reduce((total, item) => total + item.milkAmount!, 0) * 1e9) / 1e9;
        evidence.push({ field: "milkAmount", kind: "calculated", detail: "sum of known bottle milkItems", confirmed: true });
      } else delete facts.milkAmount;
    }
    const prepared = facts.preparedMilkAmount; const remaining = facts.remainingMilkAmount; const consumed = facts.milkAmount;
    if (typeof prepared === "number" && typeof remaining === "number") {
      if (remaining > prepared) issue("REMAINDER_EXCEEDS_PREPARED", ["preparedMilkAmount", "remainingMilkAmount"], "剩余量不能超过同一瓶的泡好量");
      else if (facts.sameBottle === true && facts.milkItems?.length === 1 && typeof consumed === "number" && Math.abs(consumed - (prepared - remaining)) > 1e-6) issue("MILK_AMOUNT_MISMATCH", ["milkAmount", "preparedMilkAmount", "remainingMilkAmount"], "实际喝入量与同一瓶的泡好量减剩余量不一致");
    }
    if (facts.milkItems?.length === 1 && typeof prepared === "number" && typeof facts.milkAmount === "number" && facts.milkAmount > prepared) issue("CONSUMED_EXCEEDS_PREPARED", ["milkAmount", "preparedMilkAmount"], "实际喝入量超过泡好量，请核对是否同一瓶");
  }
  if (type === "PUMP") requireOutcome("milkAmount");

  const applyDefault = <K extends Field>(field: K, value: NonNullable<Facts[K]>, detail: string) => {
    const explicitlyAbsent = hasOwn(input.facts, field) && input.facts[field] == null;
    if (present(facts[field]) || explicitlyAbsent || states[field] === "unknown" || uncertainImage(field) || explicitEvidence(field)) return;
    facts[field] = value; states[field] = "known";
    evidence.push({ field, kind: "default", detail, confirmed: true });
  };
  if (type === "DIAPER") {
    applyDefault("hasPee", true, "业务默认：未报告尿便情况时按有尿记录");
    applyDefault("hasPoop", false, "业务默认：未报告尿便情况时按无便记录");
    requireField("hasPoop"); requireField("hasPee");
    if (facts.hasPoop === false) { notApplicable("poopColor"); notApplicable("poopPhotoUrl"); }
    if (facts.hasPee === true) applyDefault("peeAmount", "LARGE", "业务默认：有尿且未报告尿量时按 LARGE 记录");
    else if (facts.hasPee === false) notApplicable("peeAmount");
    if (facts.hasPoop === false && facts.hasPee === false) issue("EMPTY_DIAPER", ["hasPoop", "hasPee"], "已明确无尿无便，请核对是否需要保存本次换尿布");
  }
  if (type === "SUPPLEMENT") requireField("supplementType");
  if (type === "SPIT_UP") applyDefault("spitUpType", "NORMAL", "业务默认：未报告特殊情况时按普通吐奶记录");

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
  // A source can report two distinct completed bottle intakes at one message
  // timestamp. Different amounts are handled by duplicate detection upstream;
  // point timestamps alone must not force those facts into one event.
  if (facts.type === "BOTTLE" && other.type === "BOTTLE" && aStart === aEnd && bStart === bEnd) return [];
  const feeds = new Set(["BREASTFEED", "BOTTLE"]);
  const awake = new Set(["HEAD_LIFT", "PASSIVE_EXERCISE", "ROLL_OVER", "PULL_TO_SIT", "GAS_EXERCISE", "BATH", "EARLY_EDUCATION"]);
  if ((facts.type === other.type && durationRequiredTypes.has(facts.type)) || (feeds.has(facts.type) && feeds.has(other.type)) || (facts.type === "SLEEP" && awake.has(other.type)) || (other.type === "SLEEP" && awake.has(facts.type))) {
    return [{ code: "TIME_OVERLAP", fields: ["startTime", "endTime"], message: "与已有活动时间重叠，请核对记录或确认实际情况" }];
  }
  return [];
}
