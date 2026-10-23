import { ACTIVITY_TYPES, type Activity, type AuthContext, type Baby, type DailyStat, type RecordCoverage, type RecordSummary, type RecordSnapshot, type RecordTypeSummary, type RecordEvent, type RecordCollection, type RecordSyncStatus } from "../model/types";

export class ResponseFormatError extends Error {
  constructor() { super("服务返回的数据格式不正确，请刷新后重试。"); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResponseFormatError();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new ResponseFormatError();
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!result.trim()) throw new ResponseFormatError();
  return result;
}
function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ResponseFormatError();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ResponseFormatError();
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new ResponseFormatError();
  return result;
}
function optional<T>(value: unknown, decode: (value: unknown) => T): T | null | undefined {
  return value === undefined || value === null ? value : decode(value);
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((item) => item === value);
  if (found === undefined) throw new ResponseFormatError();
  return found;
}
export function array<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new ResponseFormatError();
  return value.map(decode);
}
export function baby(value: unknown): Baby {
  const row = object(value);
  return { id: id(row.id), name: text(row.name), fullName: optional(row.fullName, text),
    avatarUrl: optional(row.avatarUrl, text), birthDate: optional(row.birthDate, date),
    gender: optional(row.gender, (item) => choice(item, ["BOY", "GIRL", "OTHER"] as const)),
    ...(row.isDefault !== undefined ? { isDefault: boolean(row.isDefault) } : {}) };
}
export function authContext(value: unknown): AuthContext {
  const row = object(value);
  const authenticated = boolean(row.authenticated);
  const hasBaby = boolean(row.hasBaby);
  if (!authenticated) return { authenticated: false, hasBaby: false, baby: null, babies: [] };
  const current = row.baby === null ? null : baby(row.baby);
  const babies = array(row.babies, baby);
  if (hasBaby !== !!current || (current && !babies.some((item) => item.id === current.id))) throw new ResponseFormatError();
  return { authenticated, hasBaby, baby: current, babies,
    defaultBabyId: optional(row.defaultBabyId, id),
    ...(row.identityId !== undefined ? { identityId: id(row.identityId) } : {}),
    ...(row.legacyLinked !== undefined ? { legacyLinked: boolean(row.legacyLinked) } : {}),
    ...(typeof row.code === "string" ? { code: row.code } : {}) };
}
export function activity(value: unknown): Activity {
  const row = object(value);
  return {
    id: id(row.id), type: choice(row.type, ACTIVITY_TYPES), startTime: date(row.startTime),
    endTime: optional(row.endTime, date), createdAt: optional(row.createdAt, date), updatedAt: optional(row.updatedAt, date),
    ...(row.babyId !== undefined ? { babyId: id(row.babyId) } : {}),
    hasPoop: optional(row.hasPoop, boolean), hasPee: optional(row.hasPee, boolean),
    poopColor: optional(row.poopColor, (item) => choice(item, ["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"] as const)),
    poopPhotoUrl: optional(row.poopPhotoUrl, text),
    peeAmount: optional(row.peeAmount, (item) => choice(item, ["SMALL", "MEDIUM", "LARGE"] as const)),
    burpSuccess: optional(row.burpSuccess, boolean), milkAmount: optional(row.milkAmount, numeric),
    milkSource: optional(row.milkSource, (item) => choice(item, ["BREAST_MILK", "FORMULA"] as const)),
    breastFirmness: optional(row.breastFirmness, (item) => choice(item, ["SOFT", "ELASTIC", "HARD"] as const)),
    supplementType: optional(row.supplementType, (item) => choice(item, ["AD", "D3", "PROBIOTICS", "PREBIOTICS"] as const)),
    spitUpType: optional(row.spitUpType, (item) => choice(item, ["NORMAL", "PROJECTILE"] as const)),
    count: optional(row.count, numeric), notes: optional(row.notes, text),
  };
}
export function dailyStat(value: unknown): DailyStat {
  const row = object(value);
  const result: DailyStat = {
    id: id(row.id), date: date(row.date),
    ...(row.babyId !== undefined ? { babyId: id(row.babyId) } : {}),
    sleepCount: numeric(row.sleepCount), totalSleepMinutes: numeric(row.totalSleepMinutes),
    totalMilkAmount: numeric(row.totalMilkAmount), totalPumpMilkAmount: numeric(row.totalPumpMilkAmount), diaperCount: numeric(row.diaperCount),
    createdAt: optional(row.createdAt, date), updatedAt: optional(row.updatedAt, date),
  };
  const counts = ["breastfeedCount", "totalBreastfeedMinutes", "bottleCount", "pumpCount", "poopCount", "peeCount", "exerciseCount", "totalHeadLiftMinutes", "supplementADCount", "supplementD3Count", "supplementProbioticsCount", "supplementPrebioticsCount", "spitUpCount", "projectileSpitUpCount"] as const;
  for (const key of counts) if (row[key] !== undefined) result[key] = numeric(row[key]);
  if (row.coverage !== undefined) result.coverage = recordCoverage(row.coverage);
  if (row.byType !== undefined) result.byType = recordTypes(row.byType);
  return result;
}
export function recordCoverage(value: unknown): RecordCoverage {
  const row = object(value);
  const keys = ["recordedEvents", "incompleteEvents", "pendingFields", "unknownFields", "ongoingEvents", "pendingCandidates", "duplicateCandidates", "unresolvedTime", "knownMilkAmounts", "unknownMilkAmounts", "knownZeroMilkAmounts"] as const;
  const values = Object.fromEntries(keys.map(key => [key, numeric(row[key])]));
  if (Object.values(values).some(value => value < 0)) throw new ResponseFormatError();
  return { ...values, eventsWithUnknownFields: array(row.eventsWithUnknownFields, id), pendingEventIds: array(row.pendingEventIds, id) } as unknown as RecordCoverage;
}
function recordTypes(value: unknown): Record<string, RecordTypeSummary> {
  const row = object(value); const result: Record<string, RecordTypeSummary> = {};
  const fields = ["events", "knownMinutes", "knownCount", "unknownCount", "knownMilkAmount", "preparedMilkAmount", "knownMilkAmounts", "unknownMilkAmounts", "knownDurations", "unknownDurations", "ongoingEvents"] as const;
  for (const type of ACTIVITY_TYPES) {
    const entry = object(row[type]);
    const values = Object.fromEntries(fields.map(field => [field, numeric(entry[field])]));
    if (Object.values(values).some(value => value < 0)) throw new ResponseFormatError();
    result[type] = values as unknown as RecordTypeSummary;
  }
  return result;
}
export function recordSummary(value: unknown): RecordSummary {
  const row = object(value);
  const source = object(row.metrics);
  const metricNames = ["sleepCount", "totalSleepMinutes", "breastfeedCount", "totalBreastfeedMinutes", "bottleCount", "totalMilkAmount", "pumpCount", "totalPumpMilkAmount", "diaperCount", "poopCount", "peeCount", "exerciseCount", "totalHeadLiftMinutes", "supplementADCount", "supplementD3Count", "supplementProbioticsCount", "supplementPrebioticsCount", "spitUpCount", "projectileSpitUpCount"];
  const metrics = Object.fromEntries(metricNames.map(key => [key, numeric(source[key])]));
  if (Object.values(metrics).some(value => value < 0)) throw new ResponseFormatError();
  return { metrics, coverage: recordCoverage(row.coverage), byType: recordTypes(row.byType) };
}
export function recordEvent(value: unknown): RecordEvent {
  const row = object(value);
  const states = Object.fromEntries(Object.entries(object(row.states)).map(([field, state]) => [field, choice(state, ["known", "pending", "unknown", "not_applicable", "not_yet"] as const)]));
  const version = numeric(row.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new ResponseFormatError();
  const attachmentIds = array(row.attachmentIds, id);
  if (attachmentIds.some(value => !/^att_[a-f0-9]{64}$/.test(value))) throw new ResponseFormatError();
  const progress = choice(row.progress, ["ongoing", "ended", "unknown"] as const);
  const current = row.currentActivity ? activity(row.currentActivity) : null;
  const facts = row.facts ? object(row.facts) : {};
  if (current?.babyId && current.babyId !== row.babyId) throw new ResponseFormatError();
  const currentProgress = current?.endTime ? "ended" : current && progress === "ongoing" && current.type === facts.type && Date.parse(current.startTime) === Date.parse(String(facts.startTime)) ? "ongoing" : "unknown";
  return { id: id(row.id), babyId: id(row.babyId), legacyId: id(row.legacyId), version,
    progress, currentProgress, projection: choice(row.projection, ["candidate", "pending", "synced", "conflict"] as const),
    complete: boolean(row.complete), states, missing: array(row.missing, id), attachmentIds,
    conflicts: array(row.conflicts, value => { const conflict = object(value); return { code: id(conflict.code), fields: array(conflict.fields, id) }; }),
    // Deliberately do not retain account, group, sender or message identifiers for presentation.
    sources: array(row.sources, value => { const source = object(value); return { kind: choice(source.kind, ["chat", "wechat", "manual"] as const), sentAt: date(source.sentAt) }; }) };
}
export function recordCollection(value: unknown): RecordCollection {
  const row = object(value);
  return { activities: array(row.activities, activity), events: array(row.events, recordEvent),
    questions: array(row.questions, value => { const question = object(value); return { id: id(question.id), babyId: id(question.babyId), eventId: id(question.eventId), state: choice(question.state, ["open", "resolved", "dismissed"] as const) }; }) };
}
export function recordSnapshot(value: unknown): RecordSnapshot {
  return { ...recordCollection(value), summary: recordSummary(object(value).summary) };
}
export function recordSyncStatus(value: unknown): RecordSyncStatus {
  const row = object(value); const pendingMedia = row.pendingMedia === undefined ? 0 : numeric(row.pendingMedia);
  if (!Number.isSafeInteger(pendingMedia) || pendingMedia < 0) throw new ResponseFormatError();
  const failure = row.failure ? object(row.failure) : null;
  return { id: id(row.id), enabled: boolean(row.enabled), lastSuccessAt: optional(row.lastSuccessAt, date) ?? null,
    processedThrough: optional(row.processedThrough, date) ?? null, pending: boolean(row.pending), pendingMedia,
    failure: failure ? { code: id(failure.code), at: date(failure.at), attempts: numeric(failure.attempts) } : null };
}
export type BabyList = { data: Baby[]; defaultBabyId: string | null; currentBabyId: string | null };
export function babyList(value: unknown): BabyList {
  const row = object(value);
  return { data: array(row.data, baby), defaultBabyId: row.defaultBabyId === null ? null : id(row.defaultBabyId), currentBabyId: row.currentBabyId === null ? null : id(row.currentBabyId) };
}
