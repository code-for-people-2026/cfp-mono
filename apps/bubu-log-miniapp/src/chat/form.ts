import type { ChatPending, FieldPending, PendingEventForm, StructuredFormAnswer, StructuredFormProgress } from "./contracts";

export type PendingFieldValue =
  | { kind: "value"; value: string | number | boolean }
  | { kind: "unknown" }
  | { kind: "notYet" }
  | { kind: "timestamp"; date: string; time: string };

export interface PendingFormDraft { fields: Partial<Record<string, PendingFieldValue>>; progress?: StructuredFormProgress }

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isExplicitUnknownText = (value: string) => /^(?:不知道|不清楚)(?:了)?[。.!！?？]?$/.test(value.trim());

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fieldValue(value: unknown): value is PendingFieldValue {
  if (!object(value) || typeof value.kind !== "string") return false;
  if (value.kind === "unknown" || value.kind === "notYet") return true;
  if (value.kind === "value") return ["string", "number", "boolean"].includes(typeof value.value);
  if (value.kind === "timestamp") return typeof value.date === "string" && typeof value.time === "string";
  return false;
}

export function isPendingFormDraft(value: unknown): value is PendingFormDraft {
  return object(value) && object(value.fields) && Object.entries(value.fields).every(([key, item]) => !!key && fieldValue(item))
    && (value.progress === undefined || (typeof value.progress === "string" && ["ongoing", "ended", "unknown"].includes(value.progress)));
}

export function emptyPendingFormDraft(): PendingFormDraft { return { fields: {} }; }

export function pendingQuestionKey(questionId: string, questionVersion: number, eventId: string, eventVersion: number): string {
  return `${encodeURIComponent(questionId)}@${questionVersion}:${encodeURIComponent(eventId)}@${eventVersion}`;
}
export function pendingFormKey(form: PendingEventForm): string { return pendingQuestionKey(form.questionId, form.questionVersion, form.eventId, form.eventVersion); }

function clean(draft: PendingFormDraft, fields: Partial<Record<string, PendingFieldValue>>): PendingFormDraft {
  return { ...draft, fields };
}

export function setPendingFieldValue(draft: PendingFormDraft, field: string, value: PendingFieldValue): PendingFormDraft {
  const fields = { ...draft.fields, [field]: value };
  // End time and duration describe the same fact. Even a partially picked timestamp must
  // replace the alternate, or a stale draft could turn an unfinished choice into an answer.
  if (field === "endTime") delete fields.durationMinutes;
  if (field === "durationMinutes") delete fields.endTime;
  return clean(draft, fields);
}

export function clearPendingFieldValue(draft: PendingFormDraft, field: string): PendingFormDraft {
  const fields = { ...draft.fields }; delete fields[field]; return clean(draft, fields);
}

export function setPendingFormProgress(draft: PendingFormDraft, progress: StructuredFormProgress): PendingFormDraft {
  if (progress === "ended") return { ...draft, progress };
  const fields = { ...draft.fields };
  delete fields.endTime; delete fields.durationMinutes;
  return { ...draft, fields, progress };
}
export function clearPendingFormProgress(draft: PendingFormDraft): PendingFormDraft {
  const next = { ...draft };
  delete next.progress;
  return next;
}

function timestamp(value: { date: string; time: string }): string | null {
  if (!datePattern.test(value.date) || !timePattern.test(value.time)) return null;
  const [year, month, day] = value.date.split("-").map(Number), [hour, minute] = value.time.split(":").map(Number);
  const utc = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!));
  if ([utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes()]
    .join("-") !== [year, month, day, hour, minute].join("-")) return null;
  return `${value.date}T${value.time}:00.000+08:00`;
}

function authoritativeTemporalField(form: PendingEventForm): "endTime" | "durationMinutes" | undefined {
  if (form.controls.some(control => control.field === "endTime")) return "endTime";
  if (form.controls.some(control => control.field === "durationMinutes")) return "durationMinutes";
  return undefined;
}

export function buildPendingFormAnswer(form: PendingEventForm, input: PendingFormDraft, texts: Record<string, string> = {}): { answer?: StructuredFormAnswer; error?: string } {
  const facts: Record<string, unknown> = {};
  const states: Record<string, string> = {};
  const milkItemAnswers = new Map<string, NonNullable<StructuredFormAnswer["milkItemAnswers"]>[number]>();
  const itemAnswer = (milkItemId: string) => {
    let answer = milkItemAnswers.get(milkItemId);
    if (!answer) { answer = { milkItemId }; milkItemAnswers.set(milkItemId, answer); }
    return answer;
  };
  const parseNumber = (label: string, unit: "ml" | "minutes" | "times", value: PendingFieldValue): number | undefined => {
    if (value.kind !== "value") return undefined;
    if (typeof value.value === "boolean") return undefined;
    const text = typeof value.value === "string" ? value.value.trim() : String(value.value);
    if (!text) throw new Error(`请输入有效的${label}。`);
    const raw = Number(text);
    if (!Number.isFinite(raw) || raw < 0 || raw > (unit === "times" ? 100000 : unit === "minutes" ? 10080 : 100000)) throw new Error(`请输入有效的${label}。`);
    if (unit === "times" && !Number.isSafeInteger(raw)) throw new Error("次数必须是整数。");
    return raw;
  };
  for (const control of form.controls) {
    const draftKey = control.draftKey ?? control.field;
    const value = input.fields[draftKey];
    if (control.milkItemId && control.field === "milkSource" && texts[draftKey]?.trim()) {
      const answer = itemAnswer(control.milkItemId);
      if (isExplicitUnknownText(texts[draftKey]!)) answer.states = { ...answer.states, milkSourceState: "unknown" };
      else answer.facts = { ...answer.facts, milkDescription: texts[draftKey]!.trim() };
      continue;
    }
    if (!value) continue;
    if (control.milkItemId) {
      const answer = itemAnswer(control.milkItemId);
      if (control.field === "milkAmount") {
        if (value.kind === "unknown") answer.states = { ...answer.states, milkAmountState: "unknown" };
        else {
          try { const raw = parseNumber(control.label, "ml", value); if (raw !== undefined) answer.facts = { ...answer.facts, milkAmount: raw }; }
          catch (error) { return { error: error instanceof Error ? error.message : `请输入有效的${control.label}。` }; }
        }
      } else if (control.field === "milkSource") {
        if (value.kind === "unknown") answer.states = { ...answer.states, milkSourceState: "unknown" };
        else if (value.kind === "value" && typeof value.value === "string" && control.options?.some(option => option.value === value.value)) answer.facts = { ...answer.facts, milkSource: value.value as "BREAST_MILK" | "FORMULA" };
        else return { error: `请选择${control.label}。` };
      }
      continue;
    }
    if (value.kind === "unknown") { states[control.field] = "unknown"; continue; }
    if (value.kind === "notYet") {
      if (!control.allowNotYet) return { error: "这项还没有发生，不能用「尚未发生」回答。" };
      states[control.field] = "not_yet"; continue;
    }
    if (value.kind === "timestamp") {
      if (control.kind !== "timestamp") return { error: `${control.label}的时间格式不正确。` };
      const value2 = timestamp(value); if (!value2) return { error: `请同时选择${control.label}的日期和时间。` };
      facts[control.field] = value2; continue;
    }
    if (control.kind === "boolean") {
      if (typeof value.value !== "boolean") return { error: `请选择${control.label}。` };
      facts[control.field] = value.value; continue;
    }
    if (control.kind === "enum") {
      if (typeof value.value !== "string" || !control.options?.some(option => option.value === value.value)) return { error: `请选择${control.label}。` };
      facts[control.field] = value.value; continue;
    }
        try { const raw = parseNumber(control.label, control.unit ?? "ml", value); if (raw !== undefined) facts[control.field] = raw; }
    catch (error) { return { error: error instanceof Error ? error.message : `请输入有效的${control.label}。` }; }
  }
  // The pending question has one authoritative temporal field, while people may
  // answer either a clock time or a duration. Accept the alternate only for that question.
  if (authoritativeTemporalField(form) === "endTime") {
    const alternate = input.fields.durationMinutes;
    if (alternate && !facts.endTime) {
      if (alternate.kind === "unknown") states.durationMinutes = "unknown";
      else {
        try { const raw = parseNumber("时长", "minutes", alternate); if (raw !== undefined) facts.durationMinutes = raw; }
        catch (error) { return { error: error instanceof Error ? error.message : "请输入有效的时长。" }; }
      }
    }
  } else if (authoritativeTemporalField(form) === "durationMinutes") {
    const alternate = input.fields.endTime;
    if (alternate && !facts.durationMinutes) {
      if (alternate.kind === "timestamp") {
        const raw = timestamp(alternate); if (!raw) return { error: "请同时选择结束日期和时间。" };
        facts.endTime = raw;
      } else if (alternate.kind === "unknown") states.endTime = "unknown";
    }
  }
  const authoritative = authoritativeTemporalField(form);
  const hasConcreteEnd = facts.endTime !== undefined || facts.durationMinutes !== undefined;
  let progress = input.progress;
  if (hasConcreteEnd) progress = "ended";
  if (progress === "ended" && !hasConcreteEnd && !states[authoritative ?? ""]) return { error: "选择「已经结束」时，请填写结束时间或时长。" };
  if (progress && authoritative && !hasConcreteEnd) states[authoritative] = "unknown";
  if (!Object.keys(facts).length && !Object.keys(states).length && !progress && !milkItemAnswers.size) return { error: "请至少选择或填写一项，也可以使用自定义补充说明。" };
  return { answer: { facts, ...(Object.keys(states).length ? { states: states as StructuredFormAnswer["states"] } : {}), ...(form.progressControl && progress ? { progress } : {}), ...(milkItemAnswers.size ? { milkItemAnswers: [...milkItemAnswers.values()] } : {}) } };
}

export interface PendingEventGroup {
  key: string; eventId?: string; field?: FieldPending; fields: FieldPending[]; media: Array<Extract<ChatPending, { kind: "media" }>>;
}

/** Counts and presents events, while ambiguous media keeps its own explicit selection path. */
export function groupPendingEvents(items: ChatPending[]): PendingEventGroup[] {
  const groups: PendingEventGroup[] = [];
  const byEvent = new Map<string, PendingEventGroup>();
  const eventGroup = (eventId: string): PendingEventGroup => {
    let group = byEvent.get(eventId);
    if (!group) {
      group = { key: `event:${eventId}`, eventId, fields: [], media: [] };
      byEvent.set(eventId, group); groups.push(group);
    }
    return group;
  };
  for (const item of items) {
    if (item.kind === "fields") {
      const group = eventGroup(item.eventId);
      group.fields.push(item); if (!group.field) group.field = item;
    } else if (item.eventIds.length === 1) eventGroup(item.eventIds[0]!).media.push(item);
  }
  for (const item of items) if (item.kind === "media" && item.eventIds.length !== 1)
    groups.push({ key: `media:${item.id}`, fields: [], media: [item] });
  return groups;
}
