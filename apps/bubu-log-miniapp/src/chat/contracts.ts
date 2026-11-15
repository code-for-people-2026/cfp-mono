import { array, object, ResponseFormatError } from "../api/contracts";
import type { ChatRequest } from "./drafts";
export type ChatFormControlField = "type" | "startTime" | "endTime" | "durationMinutes" | "milkAmount" | "milkSource" | "preparedMilkAmount" | "remainingMilkAmount" | "sameBottle" | "burpSuccess" | "breastFirmness" | "hasPoop" | "hasPee" | "poopColor" | "peeAmount" | "count" | "supplementType" | "spitUpType";
export type ChatFormControlKind = "boolean" | "enum" | "number" | "timestamp" | "duration";
export interface ChatFormControl { field: ChatFormControlField; /** Required on decoded server forms; optional only for local legacy test fixtures. */ draftKey?: string; milkItemId?: string; milkItemLabel?: string; kind: ChatFormControlKind; label: string; options?: Array<{ label: string; value: string }>; optionsSource?: "manual" | "learned" | "default"; unit?: "ml" | "minutes" | "times"; referenceTime?: string; allowUnknown: true; allowNotYet?: true }
export interface PendingFormProgressControl { field: "progress"; kind: "progress"; label: string; options: Array<{ label: string; value: "ongoing" | "ended" | "unknown" }> }
export interface PendingEventForm {
  eventId: string; eventVersion: number; questionId: string; questionVersion: number;
  title: string; activityType?: string; startedAt?: string; sourceSentAt?: string; knownSummary: string;
  controls: ChatFormControl[]; progressControl?: PendingFormProgressControl;
  conflictMessages: string[]; duplicateCandidateIds: string[];
}
export interface FieldPending { prompt?: string; kind: "fields"; id: string; babyId: string; eventId: string; version: number; eventVersion: number; fields: string[]; conflicts: string[]; duplicateCandidates: string[]; state: "open" | "resolved" | "dismissed"; form?: PendingEventForm }
export interface MediaPending { prompt?: string; kind: "media"; id: string; babyId: string; eventIds: string[]; state: "open"; sentAt?: string; media: Array<{ index: number; state: string }> }
export type ChatPending = FieldPending | MediaPending;
export type FieldState = "known" | "pending" | "unknown" | "not_applicable" | "not_yet";
export type StructuredFormProgress = "ongoing" | "ended" | "unknown";
export interface MilkItemAnswer { milkItemId: string; facts?: { milkSource?: "BREAST_MILK" | "FORMULA"; milkDescription?: string; milkAmount?: number | null }; states?: { milkSourceState?: "known" | "pending" | "unknown"; milkAmountState?: "known" | "pending" | "unknown" } }
export interface StructuredFormAnswer { facts: Record<string, unknown>; states?: Partial<Record<string, FieldState>>; progress?: StructuredFormProgress; milkItemAnswers?: MilkItemAnswer[] }
export type ReplyChoiceAction = { type: "reply"; text: string } | { type: "custom" } | { type: "attach"; text: string } | { type: "reference"; text: string; attachmentIds: string[] };
export interface ReplyChoice { id: string; label: string; action: ReplyChoiceAction }
export interface ReplyQuestion {
  id: string; prompt: string; choices: ReplyChoice[];
  origin: { kind: "turn" | "pending"; turnId?: string; selectedEventId?: string; mediaPendingId?: string; question?: { id: string; questionVersion: number; eventVersion: number } };
}
export interface AutomaticActivityEvent { id: string; version: number; title: string; startedAt?: string; summary: string; complete: boolean }
export interface AutomaticActivityMessage { id: string; requestId: string; groupId: string; eventIds: string[]; occurredAt: string; outcome: "saved" | "needs_information" | "pending_projection" | "conflict"; text: string; events: AutomaticActivityEvent[] }
export interface FirstWeekNotice {
  id: string; timestamp: string; text: string; periodStart: string; periodEnd: string;
  sampleCounts: Record<string, number>; actualOptions: Record<string, Array<{ value: number; supportCount: number }>>;
  suggestions: Record<string, Array<{ value: number; supportCount: number }>>; patternStatement: string;
  instructions: "可继续聊天调整，也可到设置修改";
}
export type OriginalMessageKind = "wechat" | "chat" | "test";
export interface OriginalMessage {
  id: string; kind: OriginalMessageKind; senderId: string | null; senderName?: string;
  senderAvatarUrl?: string; label?: "测试记录 · 模拟消息"; sentAt: string; text: string | null;
}
export interface EventSources {
  babyId: string; eventId: string; messages: OriginalMessage[]; unavailableCount: number;
}
export interface ChatTurn {
  id: string; requestId: string; babyId: string; createdAt: string; updatedAt: string;
  status: "processing" | "completed" | "failed" | "needs_recovery";
  input: Omit<ChatRequest, "babyId" | "requestId">; assistantText: string; replyQuestions?: ReplyQuestion[]; replySource?: "ai" | "safety";
  receipts: Array<{ status: "saved" | "needs_information" | "pending_projection" | "conflict"; events?: Array<{ id: string; version: number }> } | { kind: "media"; state: "resolved" | "open" }>;
  pending: ChatPending[]; refreshRequired: boolean; batchProgress?: { total: number; completed: number }; error?: { code: string; message: string; retryable: boolean };
}
export interface ChatHistory { babyId: string; conversationId: string; turns: ChatTurn[]; pending: ChatPending[]; pendingCount: number; replyQuestions?: ReplyQuestion[]; automaticMessages: AutomaticActivityMessage[]; firstWeekNotice?: FirstWeekNotice }
export interface Attachment { id: string; babyId: string; url: string; mime: "image/jpeg" | "image/png" | "image/webp"; byteLength: number }
const text = (value: unknown): string => { if (typeof value !== "string") throw new ResponseFormatError(); return value; };
const id = (value: unknown): string => { const result = text(value); if (!result.trim()) throw new ResponseFormatError(); return result; };
const integer = (value: unknown): number => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ResponseFormatError(); return value; };
const bool = (value: unknown): boolean => { if (typeof value !== "boolean") throw new ResponseFormatError(); return value; };
const date = (value: unknown): string => { const result = text(value); if (!Number.isFinite(Date.parse(result))) throw new ResponseFormatError(); return result; };
function choice<T extends string>(value: unknown, choices: readonly T[]): T { const match = choices.find(item => item === value); if (!match) throw new ResponseFormatError(); return match; }
const positiveInteger = (value: unknown): number => { const result = integer(value); if (!result) throw new ResponseFormatError(); return result; };
const jsonValue = (value: unknown): void => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (Array.isArray(value)) return value.forEach(jsonValue);
  if (value && typeof value === "object") return Object.values(object(value)).forEach(jsonValue);
  throw new ResponseFormatError();
};
const activityType = (value: unknown): string => choice(value, ["BREASTFEED", "BOTTLE", "PUMP", "SLEEP", "DIAPER", "HEAD_LIFT", "PASSIVE_EXERCISE", "GAS_EXERCISE", "BATH", "OUTDOOR", "EARLY_EDUCATION", "ROLL_OVER", "PULL_TO_SIT", "SUPPLEMENT", "SPIT_UP"] as const);
const controlField = (value: unknown): ChatFormControlField => choice(value, ["type", "startTime", "endTime", "durationMinutes", "milkAmount", "milkSource", "preparedMilkAmount", "remainingMilkAmount", "sameBottle", "burpSuccess", "breastFirmness", "hasPoop", "hasPee", "poopColor", "peeAmount", "count", "supplementType", "spitUpType"] as const);
function decodeOptions(value: unknown): Array<{ label: string; value: string }> {
  return array(value, item => { const row = object(item); return { label: text(row.label), value: id(row.value) }; });
}
function decodeForm(value: unknown, pending: { eventId: string; eventVersion: number; id: string; version: number; fields: string[] }): PendingEventForm {
  const row = object(value), eventId = id(row.eventId), eventVersion = positiveInteger(row.eventVersion), questionId = id(row.questionId), questionVersion = positiveInteger(row.questionVersion);
  if (eventId !== pending.eventId || eventVersion !== pending.eventVersion || questionId !== pending.id || questionVersion !== pending.version) throw new ResponseFormatError();
  const fields = new Set(pending.fields);
  const controls = array(row.controls, item => {
    const control = object(item), field = controlField(control.field), kind = choice(control.kind, ["boolean", "enum", "number", "timestamp", "duration"] as const);
    if (!fields.has(field)) throw new ResponseFormatError();
    if (control.allowUnknown !== true) throw new ResponseFormatError();
    if (kind === "boolean" && control.field !== "sameBottle" && control.field !== "burpSuccess" && control.field !== "hasPoop" && control.field !== "hasPee") throw new ResponseFormatError();
    if (kind === "enum" && field !== "type" && field !== "milkSource" && field !== "breastFirmness" && field !== "poopColor" && field !== "peeAmount" && field !== "supplementType" && field !== "spitUpType") throw new ResponseFormatError();
    if (kind === "number" && field !== "milkAmount" && field !== "preparedMilkAmount" && field !== "remainingMilkAmount" && field !== "count") throw new ResponseFormatError();
    if (kind === "timestamp" && field !== "startTime" && field !== "endTime") throw new ResponseFormatError();
    if (kind === "duration" && field !== "durationMinutes") throw new ResponseFormatError();
    const options = control.options === undefined ? undefined : decodeOptions(control.options);
    const unit = control.unit === undefined ? undefined : choice(control.unit, ["ml", "minutes", "times"] as const);
    if ((kind === "boolean" || kind === "enum") && (!options || !options.length)) throw new ResponseFormatError();
    if (kind === "number" && !unit) throw new ResponseFormatError();
    if (kind === "duration" && unit !== "minutes") throw new ResponseFormatError();
    if (kind === "timestamp" && unit) throw new ResponseFormatError();
    const optionsSource = control.optionsSource === undefined ? undefined : choice(control.optionsSource, ["manual", "learned", "default"] as const);
    const draftKey = id(control.draftKey), milkItemId = control.milkItemId === undefined ? undefined : id(control.milkItemId);
    if (milkItemId ? !["milkAmount", "milkSource"].includes(field) || draftKey !== `${field}:${milkItemId}` : draftKey !== field) throw new ResponseFormatError();
    return { field, draftKey, ...(milkItemId ? { milkItemId } : {}), ...(control.milkItemLabel === undefined ? {} : { milkItemLabel: text(control.milkItemLabel) }), kind, label: text(control.label), ...(options ? { options } : {}), ...(optionsSource ? { optionsSource } : {}), ...(unit ? { unit } : {}), ...(control.referenceTime === undefined ? {} : { referenceTime: date(control.referenceTime) }), allowUnknown: true as const, ...(control.allowNotYet === true ? { allowNotYet: true as const } : {}) };
  });
  if (new Set(controls.map(control => control.draftKey)).size !== controls.length) throw new ResponseFormatError();
  const progress = row.progressControl === undefined ? undefined : (() => {
    const control = object(row.progressControl);
    if (control.field !== "progress" || control.kind !== "progress") throw new ResponseFormatError();
    return { field: "progress" as const, kind: "progress" as const, label: text(control.label), options: array(control.options, item => {
      const option = object(item); return { label: text(option.label), value: choice(option.value, ["ongoing", "ended", "unknown"] as const) };
    }) };
  })();
  if (progress && !progress.options.length) throw new ResponseFormatError();
  return { eventId, eventVersion, questionId, questionVersion, title: text(row.title), ...(row.activityType === undefined ? {} : { activityType: activityType(row.activityType) }), ...(row.startedAt === undefined ? {} : { startedAt: date(row.startedAt) }), ...(row.sourceSentAt === undefined ? {} : { sourceSentAt: date(row.sourceSentAt) }), knownSummary: text(row.knownSummary), controls, ...(progress ? { progressControl: progress } : {}), conflictMessages: array(row.conflictMessages, text), duplicateCandidateIds: array(row.duplicateCandidateIds, id) };
}
function decodeFormAnswer(value: unknown): StructuredFormAnswer {
  const row = object(value), facts = object(row.facts);
  Object.values(facts).forEach(jsonValue);
  const states = row.states === undefined ? undefined : object(row.states);
  if (states) Object.entries(states).forEach(([key, state]) => { id(key); choice(state, ["known", "pending", "unknown", "not_applicable", "not_yet"] as const); });
  const milkItemAnswers = row.milkItemAnswers === undefined ? undefined : array(row.milkItemAnswers, value => {
    const item = object(value), facts = item.facts === undefined ? undefined : object(item.facts), states = item.states === undefined ? undefined : object(item.states);
    if (facts && Object.keys(facts).some(key => !["milkSource", "milkDescription", "milkAmount"].includes(key)) || states && Object.keys(states).some(key => !["milkSourceState", "milkAmountState"].includes(key))) throw new ResponseFormatError();
    const decodedFacts = facts ? {
      ...(facts.milkSource === undefined ? {} : { milkSource: choice(facts.milkSource, ["BREAST_MILK", "FORMULA"] as const) }),
      ...(facts.milkDescription === undefined ? {} : { milkDescription: id(facts.milkDescription) }),
      ...(facts.milkAmount === undefined ? {} : { milkAmount: facts.milkAmount === null ? null : (() => { const result = Number(facts.milkAmount); if (typeof facts.milkAmount !== "number" || !Number.isFinite(result) || result < 0) throw new ResponseFormatError(); return result; })() }),
    } : undefined;
    const decodedStates = states ? {
      ...(states.milkSourceState === undefined ? {} : { milkSourceState: choice(states.milkSourceState, ["known", "pending", "unknown"] as const) }),
      ...(states.milkAmountState === undefined ? {} : { milkAmountState: choice(states.milkAmountState, ["known", "pending", "unknown"] as const) }),
    } : undefined;
    if (!Object.keys(decodedFacts || {}).length && !Object.keys(decodedStates || {}).length) throw new ResponseFormatError();
    return { milkItemId: id(item.milkItemId), ...(decodedFacts ? { facts: decodedFacts } : {}), ...(decodedStates ? { states: decodedStates } : {}) };
  });
  if (milkItemAnswers && new Set(milkItemAnswers.map(item => item.milkItemId)).size !== milkItemAnswers.length) throw new ResponseFormatError();
  return { facts, ...(states ? { states: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, choice<FieldState>(state, ["known", "pending", "unknown", "not_applicable", "not_yet"] as const)])) } : {}), ...(row.progress === undefined ? {} : { progress: choice(row.progress, ["ongoing", "ended", "unknown"] as const) }), ...(milkItemAnswers ? { milkItemAnswers } : {}) };
}
function decodeChoiceAnswer(value: unknown) {
  const answer = object(value);
  return { questionId: id(answer.questionId), choiceId: id(answer.choiceId), ...(answer.originTurnId === undefined ? {} : { originTurnId: id(answer.originTurnId) }), ...(answer.eventVersion === undefined ? {} : { eventVersion: positiveInteger(answer.eventVersion) }) };
}
function decodeQuestion(value: unknown) {
  const pin = object(value);
  return { id: id(pin.id), questionVersion: positiveInteger(pin.questionVersion), eventVersion: positiveInteger(pin.eventVersion) };
}
function decodeReplyQuestion(value: unknown): ReplyQuestion {
  const row = object(value), origin = object(row.origin), kind = choice(origin.kind, ["turn", "pending"] as const);
  const question = origin.question === undefined ? undefined : (() => {
    const pin = object(origin.question);
    return { id: id(pin.id), questionVersion: positiveInteger(pin.questionVersion), eventVersion: positiveInteger(pin.eventVersion) };
  })();
  const choices = array(row.choices, item => {
    const option = object(item), action = object(option.action), type = choice(action.type, ["reply", "custom", "attach", "reference"] as const);
    const decodedAction: ReplyChoiceAction = type === "custom" ? { type }
      : type === "reference" ? { type, text: text(action.text), attachmentIds: array(action.attachmentIds, attachmentId => {
        const value = id(attachmentId); if (!/^att_[a-f0-9]{64}$/.test(value)) throw new ResponseFormatError(); return value;
      }) }
      : { type, text: text(action.text) };
    if (decodedAction.type === "reference" && !decodedAction.attachmentIds.length) throw new ResponseFormatError();
    return { id: id(option.id), label: text(option.label), action: decodedAction };
  });
  if (choices.length < 2 || new Set(choices.map(item => item.id)).size !== choices.length || choices.some((item, index) => item.action.type === "custom" && index !== choices.length - 1)) throw new ResponseFormatError();
  const turnId = origin.turnId === undefined ? undefined : id(origin.turnId);
  if (kind === "turn" && !turnId) throw new ResponseFormatError();
  return { id: id(row.id), prompt: text(row.prompt), choices, origin: { kind, ...(turnId ? { turnId } : {}), ...(origin.selectedEventId === undefined ? {} : { selectedEventId: id(origin.selectedEventId) }), ...(origin.mediaPendingId === undefined ? {} : { mediaPendingId: id(origin.mediaPendingId) }), ...(question ? { question } : {}) } };
}
export const attachmentUrl = (babyId: string, attachmentId: string) => `/api/app/attachments/${attachmentId}?babyId=${encodeURIComponent(babyId)}`;
export function decodeEventSources(value: unknown, babyId: string, eventId: string): EventSources {
  const row = object(value), sourceBabyId = id(row.babyId), sourceEventId = id(row.eventId);
  if (sourceBabyId !== babyId || sourceEventId !== eventId) throw new ResponseFormatError();
  return {
    babyId: sourceBabyId, eventId: sourceEventId,
    messages: array(row.messages, item => {
      const message = object(item);
      const senderAvatarUrl = message.senderAvatarUrl === undefined ? undefined : (() => {
        const value = text(message.senderAvatarUrl).trim();
        if (!value || value.length > 2048 || Array.from(value).some(character => {
          const code = character.charCodeAt(0); return code <= 31 || code === 127;
        })) throw new ResponseFormatError();
        const protectedMatch = /^\/api\/app\/(?:media\/activities\/[A-Za-z0-9%_.~-]+|attachments\/att_[a-f0-9]{64})\?babyId=([^&#]+)$/.exec(value);
        if (protectedMatch) {
          let scopedBabyId = "";
          try { scopedBabyId = decodeURIComponent(protectedMatch[1]!); } catch { throw new ResponseFormatError(); }
          if (scopedBabyId !== babyId) throw new ResponseFormatError();
          return value;
        }
        let parsed: URL;
        try { parsed = new URL(value); } catch { throw new ResponseFormatError(); }
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) throw new ResponseFormatError();
        return value;
      })();
      const kind = choice(message.kind, ["wechat", "chat", "test"] as const);
      const label = message.label === undefined ? undefined : choice(message.label, ["测试记录 · 模拟消息"] as const);
      if (kind === "test" ? label === undefined : label !== undefined) throw new ResponseFormatError();
      return {
        id: id(message.id), kind,
        senderId: message.senderId === null ? null : id(message.senderId),
        ...(message.senderName === undefined ? {} : { senderName: text(message.senderName) }),
        ...(senderAvatarUrl === undefined ? {} : { senderAvatarUrl }),
        ...(label === undefined ? {} : { label }),
        sentAt: date(message.sentAt), text: message.text === null ? null : text(message.text),
      };
    }),
    unavailableCount: integer(row.unavailableCount),
  };
}
export function decodeAttachment(value: unknown, babyId: string): Attachment {
  const row = object(value), attachmentId = id(row.id);
  if (row.babyId !== babyId || !/^att_[a-f0-9]{64}$/.test(attachmentId) || row.url !== attachmentUrl(babyId, attachmentId)) throw new ResponseFormatError();
  return { id: attachmentId, babyId, url: row.url, mime: choice(row.mime, ["image/jpeg", "image/png", "image/webp"] as const), byteLength: integer(row.byteLength) };
}
export function decodePending(value: unknown, babyId: string): ChatPending {
  const row = object(value);
  if (row.babyId !== babyId) throw new ResponseFormatError();
  if (row.kind === "media") return { ...(typeof row.prompt === "string" ? { prompt: row.prompt } : {}), kind: "media", id: id(row.id), babyId, state: choice(row.state, ["open"] as const), eventIds: array(row.eventIds, id),
    ...(row.source && object(row.source).sentAt ? { sentAt: date(object(row.source).sentAt) } : {}),
    media: array(row.media, item => { const media = object(item); return { index: integer(media.index), state: choice(media.state, ["unavailable", "unlinked"] as const) }; }) };
  const version = integer(row.version), eventVersion = integer(row.eventVersion);
  if (!version || !eventVersion) throw new ResponseFormatError();
  const fields = array(row.fields, id);
  return { ...(typeof row.prompt === "string" ? { prompt: row.prompt } : {}), kind: "fields", id: id(row.id), babyId, eventId: id(row.eventId), version, eventVersion, fields,
    ...(row.form === undefined ? {} : { form: decodeForm(row.form, { eventId: id(row.eventId), eventVersion, id: id(row.id), version, fields }) }),
    conflicts: array(row.conflicts, item => id(object(item).code)), duplicateCandidates: array(row.duplicateCandidates, id), state: choice(row.state, ["open", "resolved", "dismissed"] as const) };
}
export function decodeTurn(value: unknown, babyId: string): ChatTurn {
  const row = object(value), input = object(row.input), context = object(input.context);
  if (row.babyId !== babyId) throw new ResponseFormatError();
  const viewedDate = text(context.viewedDate); if (!/^\d{4}-\d{2}-\d{2}$/.test(viewedDate)) throw new ResponseFormatError();
  const attachments = array(input.attachmentIds, id); if (attachments.length > 3 || attachments.some(value => !/^att_[a-f0-9]{64}$/.test(value))) throw new ResponseFormatError();
  const question = input.question ? decodeQuestion(input.question) : undefined;
  const choiceAnswer = input.choiceAnswer ? decodeChoiceAnswer(input.choiceAnswer) : undefined;
  const formAnswer = input.formAnswer === undefined ? undefined : decodeFormAnswer(input.formAnswer);
  if (formAnswer && (attachments.length || !question || !context.selectedEventId)) throw new ResponseFormatError();
  const formBatch = input.formBatch === undefined ? undefined : array(input.formBatch, raw => {
    const item = object(raw), itemQuestion = decodeQuestion(item.question);
    const batchFormAnswer = item.formAnswer === undefined ? undefined : decodeFormAnswer(item.formAnswer);
    const batchText = item.text === undefined ? undefined : text(item.text);
    const batchChoice = item.choiceAnswer === undefined ? undefined : decodeChoiceAnswer(item.choiceAnswer);
    if (Number(!!batchFormAnswer) + Number(batchText !== undefined) + Number(!!batchChoice) !== 1 || batchText !== undefined && (!batchText.trim() || batchText.length > 6000) || batchChoice?.originTurnId) throw new ResponseFormatError();
    return { eventId: id(item.eventId), question: itemQuestion, ...(batchFormAnswer ? { formAnswer: batchFormAnswer } : {}), ...(batchText !== undefined ? { text: batchText } : {}), ...(batchChoice ? { choiceAnswer: batchChoice } : {}) };
  });
  if (formBatch) {
    if (!formBatch.length || formBatch.length > 25 || attachments.length || formAnswer || question || choiceAnswer || context.selectedEventId || context.mediaPendingId
      || new Set(formBatch.map(item => item.eventId)).size !== formBatch.length || new Set(formBatch.map(item => item.question.id)).size !== formBatch.length
      || formBatch.reduce((sum, item) => sum + (item.text?.length ?? 0), 0) > 12000) throw new ResponseFormatError();
  }
  const batchProgress = row.batchProgress === undefined ? undefined : (() => {
    const progress = object(row.batchProgress), total = positiveInteger(progress.total), completed = integer(progress.completed);
    if (completed > total) throw new ResponseFormatError();
    return { total, completed };
  })();
  const error = row.error ? object(row.error) : undefined;
  return { id: id(row.id), requestId: id(row.requestId), babyId, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt), status: choice(row.status, ["processing", "completed", "failed", "needs_recovery"] as const),
    input: { text: text(input.text), attachmentIds: attachments, context: { viewedDate, ...(context.selectedEventId ? { selectedEventId: id(context.selectedEventId) } : {}), ...(context.mediaPendingId ? { mediaPendingId: id(context.mediaPendingId) } : {}) },
      ...(question ? { question } : {}), ...(choiceAnswer ? { choiceAnswer } : {}), ...(formAnswer ? { formAnswer } : {}), ...(formBatch ? { formBatch } : {}) },
    assistantText: text(row.assistantText), replyQuestions: array(row.replyQuestions, decodeReplyQuestion), replySource: row.replySource === "safety" ? "safety" : "ai", receipts: array(row.receipts, item => {
      const receipt = object(item);
      if (receipt.kind === "media") return { kind: "media" as const, state: choice(receipt.state, ["resolved", "open"] as const) };
      const events = receipt.events === undefined ? undefined : array(receipt.events, raw => { const event = object(raw); return { id: id(event.id), version: positiveInteger(event.version) }; });
      return { status: choice(receipt.status, ["saved", "needs_information", "pending_projection", "conflict"] as const), ...(events ? { events } : {}) };
    }),
    pending: array(row.pending, value => decodePending(value, babyId)), refreshRequired: bool(row.refreshRequired), ...(batchProgress ? { batchProgress } : {}),
    ...(error ? { error: { code: id(error.code), message: text(error.message), retryable: bool(error.retryable) } } : {}) };
}
export function decodeHistory(value: unknown, babyId: string): ChatHistory {
  const row = object(value); if (row.babyId !== babyId) throw new ResponseFormatError();
  const pending = array(row.pending, value => decodePending(value, babyId)), pendingCount = integer(row.pendingCount);
  if (pendingCount !== pending.length) throw new ResponseFormatError();
  const automaticMessages = row.automaticMessages === undefined ? [] : array(row.automaticMessages, value => {
    const message = object(value), eventIds = array(message.eventIds, id);
    return { id: id(message.id), requestId: id(message.requestId), groupId: id(message.groupId), eventIds, occurredAt: date(message.occurredAt), outcome: choice(message.outcome, ["saved", "needs_information", "pending_projection", "conflict"] as const), text: text(message.text), events: array(message.events, item => {
      const event = object(item), eventId = id(event.id), version = positiveInteger(event.version);
      return { id: eventId, version, title: text(event.title), ...(event.startedAt === undefined ? {} : { startedAt: date(event.startedAt) }), summary: text(event.summary), complete: bool(event.complete) };
    }) };
  });
  for (const message of automaticMessages) {
    const ids = [...new Set(message.eventIds)];
    if (ids.length !== message.eventIds.length || new Set(message.events.map(event => event.id)).size !== message.events.length) throw new ResponseFormatError();
  }
  const decodePatternValues = (value: unknown) => Object.fromEntries(Object.entries(object(value)).map(([key, values]) => [id(key), array(values, raw => {
    const item = object(raw); const patternValue = Number(item.value), supportCount = positiveInteger(item.supportCount);
    if (!Number.isFinite(patternValue)) throw new ResponseFormatError();
    return { value: patternValue, supportCount };
  })]));
  const notice = row.firstWeekNotice === undefined ? undefined : (() => {
    const item = object(row.firstWeekNotice);
    const sampleCounts = Object.fromEntries(Object.entries(object(item.sampleCounts)).map(([key, count]) => [id(key), positiveInteger(count)]));
    return { id: id(item.id), timestamp: date(item.timestamp), text: text(item.text), periodStart: date(item.periodStart), periodEnd: date(item.periodEnd), sampleCounts,
      actualOptions: decodePatternValues(item.actualOptions), suggestions: decodePatternValues(item.suggestions), patternStatement: text(item.patternStatement),
      instructions: choice(item.instructions, ["可继续聊天调整，也可到设置修改"] as const) };
  })();
  return { babyId, conversationId: id(row.conversationId), turns: array(row.turns, value => decodeTurn(value, babyId)), pending, pendingCount, replyQuestions: array(row.replyQuestions, decodeReplyQuestion), automaticMessages, ...(notice ? { firstWeekNotice: notice } : {}) };
}
export const fieldLabels: Record<string, string> = { type: "活动类型", startTime: "发生时间", endTime: "结束时间", durationMinutes: "时长", milkAmount: "喝入奶量", milkSource: "奶来源", preparedMilkAmount: "泡好奶量", remainingMilkAmount: "剩余奶量", sameBottle: "是否同一瓶", burpSuccess: "拍嗝结果", breastFirmness: "乳房软硬", hasPoop: "是否有便", hasPee: "是否有尿", poopColor: "大便颜色", peeAmount: "尿量", count: "次数", supplementType: "补剂类型", spitUpType: "吐奶类型" };
const fieldQuestions: Record<string, string> = {
  type: "这次是什么活动？", startTime: "大约是什么时候发生的？", endTime: "这次已经结束了吗？什么时候结束的？", durationMinutes: "这次大约持续了多久？",
  milkSource: "奶瓶里是母乳还是配方奶？", milkAmount: "宝宝实际喝了多少毫升？", preparedMilkAmount: "这瓶奶一开始泡好了多少毫升？", remainingMilkAmount: "这瓶奶还剩多少毫升？", sameBottle: "泡好和剩下的奶量是同一瓶吗？",
  burpSuccess: "结束后拍嗝成功了吗？", breastFirmness: "亲喂后乳房是柔软还是仍然偏硬？", hasPoop: "这次尿布里有大便吗？", hasPee: "这次尿布里有尿吗？", poopColor: "大便是什么颜色？", peeAmount: "尿量大约是少量、中等还是大量？",
  count: "这次明确做了多少次？", supplementType: "补充的是 AD、D3、益生菌还是益生元？", spitUpType: "这次是普通吐奶，还是喷射状吐奶？",
};
export function pendingLabel(item: ChatPending): string {
  if (item.prompt) return item.prompt;
  if (item.kind === "media") return "能补发这条群记录的照片吗？没有也可以告诉我。";
  if (item.duplicateCandidates.length) return "这与另一条记录是同一次吗？";
  if (item.conflicts.length) return "这条记录有需要核对的信息，可以说明实际情况吗？";
  return (fieldQuestions[item.fields[0]!] || "可以补充一下这条记录的情况吗？") + (item.fields.length > 1 ? `（另有 ${item.fields.length - 1} 项）` : "");
}
export function receiptLabels(turn: ChatTurn): string[] { return [...new Set(turn.receipts.map(receipt => "kind" in receipt ? receipt.state === "resolved" ? "图片待补事项已处理" : "图片仍待补充" : { saved: "已记录", needs_information: "已有内容已保留", pending_projection: "保存尚未确认，待恢复", conflict: "信息待核对" }[receipt.status]))]; }
