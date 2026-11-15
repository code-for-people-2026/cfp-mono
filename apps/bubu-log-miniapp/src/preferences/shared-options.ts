import { ACTIVITY_TYPES, type ActivityType } from "../model/types";
import { ResponseFormatError } from "../api/contracts";

export const PREFERENCE_FIELDS = ["milkAmount", "durationMinutes", "count"] as const;
export type PreferenceField = (typeof PREFERENCE_FIELDS)[number];
export type PreferenceKey = `${ActivityType}.${PreferenceField}`;
export type PreferenceSource = "manual" | "learned" | "default";

export interface PreferenceOption {
  key: PreferenceKey;
  activityType: ActivityType;
  field: PreferenceField;
  configuredValues: number[];
  effectiveValues: number[];
  source: PreferenceSource;
  version: number;
  updatedAt: string;
  usingExampleFallback: boolean;
  examplesAreFacts: false;
  examplesAreRecommendations: false;
}

export interface PatternValue { value: number; supportCount: number }
export interface FirstWeekPatternSummary {
  id: string;
  timestamp: string;
  text: string;
  periodStart: string;
  periodEnd: string;
  sampleCounts: Partial<Record<PreferenceKey, number>>;
  actualOptions: Partial<Record<PreferenceKey, PatternValue[]>>;
  suggestions: Partial<Record<PreferenceKey, PatternValue[]>>;
  patternStatement: string;
  instructions: "可继续聊天调整，也可到设置修改";
}

export interface CarePreferencesView {
  babyId: string;
  version: number;
  updatedAt: string;
  options: PreferenceOption[];
  firstWeekSummary?: FirstWeekPatternSummary;
  notices: Array<{ id: string; timestamp: string; text: string }>;
  semantics: string;
}

export interface PreferenceUpdate { key: PreferenceKey; values: number[] }
export interface UpdateCarePreferencesInput {
  babyId: string;
  requestId: string;
  expectedVersion: number;
  updates: PreferenceUpdate[];
}
export interface PreferenceMutationReceipt {
  kind: "care_preferences_changed";
  requestId: string;
  version: number;
  updatedAt: string;
  changedKeys: PreferenceKey[];
  text: string;
  preferences: CarePreferencesView;
}

const activitySet = new Set<string>(ACTIVITY_TYPES);
const fieldSet = new Set<string>(PREFERENCE_FIELDS);
export const PREFERENCE_KEYS = ACTIVITY_TYPES.flatMap(type => [
  `${type}.durationMinutes` as PreferenceKey,
  `${type}.count` as PreferenceKey,
  ...((type === "BOTTLE" || type === "PUMP") ? [`${type}.milkAmount` as PreferenceKey] : []),
]);
const allowedKeys = new Set<string>(PREFERENCE_KEYS);
const ranges: Record<PreferenceField, { min: number; max: number; integer: boolean }> = {
  milkAmount: { min: 0, max: 5000, integer: false },
  durationMinutes: { min: 0, max: 10080, integer: false },
  count: { min: 0, max: 100000, integer: true },
};

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResponseFormatError();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new ResponseFormatError();
  return row;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new ResponseFormatError();
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new ResponseFormatError();
  return result;
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ResponseFormatError();
  return Number(value);
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ResponseFormatError();
  return value;
}
function array<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new ResponseFormatError();
  return value.map(decode);
}
function preferenceKey(value: unknown): PreferenceKey {
  const key = text(value);
  if (!allowedKeys.has(key)) throw new ResponseFormatError();
  return key as PreferenceKey;
}
function activityType(value: unknown): ActivityType {
  if (typeof value !== "string" || !activitySet.has(value)) throw new ResponseFormatError();
  return value as ActivityType;
}
function field(value: unknown): PreferenceField {
  if (typeof value !== "string" || !fieldSet.has(value)) throw new ResponseFormatError();
  return value as PreferenceField;
}

export function validatePreferenceValues(key: PreferenceKey, value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 20) throw new ResponseFormatError();
  const optionField = key.split(".")[1] as PreferenceField;
  const range = ranges[optionField];
  const values = value.map(item => {
    if (typeof item !== "number" || !Number.isFinite(item) || item < range.min || item > range.max || (range.integer && !Number.isSafeInteger(item))) {
      throw new ResponseFormatError();
    }
    return item;
  });
  if (new Set(values).size !== values.length) throw new ResponseFormatError();
  return values;
}

function decodeOption(value: unknown): PreferenceOption {
  const row = object(value, ["key", "activityType", "field", "configuredValues", "effectiveValues", "source", "version", "updatedAt", "usingExampleFallback", "examplesAreFacts", "examplesAreRecommendations"]);
  const key = preferenceKey(row.key);
  const type = activityType(row.activityType);
  const optionField = field(row.field);
  if (key !== `${type}.${optionField}`) throw new ResponseFormatError();
  const configuredValues = validatePreferenceValues(key, row.configuredValues);
  const effectiveValues = validatePreferenceValues(key, row.effectiveValues);
  const source = row.source;
  if (source !== "manual" && source !== "learned" && source !== "default") throw new ResponseFormatError();
  const usingExampleFallback = bool(row.usingExampleFallback);
  if (bool(row.examplesAreFacts) || bool(row.examplesAreRecommendations)) throw new ResponseFormatError();
  if (usingExampleFallback !== (configuredValues.length === 0) || (!usingExampleFallback && effectiveValues.some((item, index) => item !== configuredValues[index]) || (!usingExampleFallback && effectiveValues.length !== configuredValues.length))) throw new ResponseFormatError();
  if (source === "default" && (!usingExampleFallback || configuredValues.length !== 0)) throw new ResponseFormatError();
  return {
    key, activityType: type, field: optionField, configuredValues, effectiveValues, source,
    version: integer(row.version), updatedAt: date(row.updatedAt), usingExampleFallback,
    examplesAreFacts: false, examplesAreRecommendations: false,
  };
}

function patternValues(key: PreferenceKey, value: unknown): PatternValue[] {
  return array(value, item => {
    const row = object(item, ["value", "supportCount"]);
    const values = validatePreferenceValues(key, [row.value]);
    const supportCount = integer(row.supportCount);
    if (supportCount < 1) throw new ResponseFormatError();
    return { value: values[0]!, supportCount };
  });
}
function keyed<T>(value: unknown, decodeValue: (key: PreferenceKey, value: unknown) => T): Partial<Record<PreferenceKey, T>> {
  const row = object(value, [...allowedKeys]);
  return Object.fromEntries(Object.entries(row).map(([key, item]) => {
    const validKey = preferenceKey(key);
    return [validKey, decodeValue(validKey, item)];
  })) as Partial<Record<PreferenceKey, T>>;
}
function decodeSummary(value: unknown): FirstWeekPatternSummary {
  const row = object(value, ["id", "timestamp", "text", "periodStart", "periodEnd", "sampleCounts", "actualOptions", "suggestions", "patternStatement", "instructions"]);
  if (row.instructions !== "可继续聊天调整，也可到设置修改") throw new ResponseFormatError();
  return {
    id: text(row.id), timestamp: date(row.timestamp), text: text(row.text), periodStart: date(row.periodStart), periodEnd: date(row.periodEnd),
    sampleCounts: keyed(row.sampleCounts, (_key, item) => integer(item)),
    actualOptions: keyed(row.actualOptions, patternValues), suggestions: keyed(row.suggestions, patternValues),
    patternStatement: text(row.patternStatement), instructions: row.instructions,
  };
}

export function decodeCarePreferences(value: unknown, babyId: string): CarePreferencesView {
  const row = object(value, ["babyId", "version", "updatedAt", "options", "firstWeekSummary", "notices", "semantics"]);
  if (text(row.babyId) !== babyId) throw new ResponseFormatError();
  const options = array(row.options, decodeOption);
  if (new Set(options.map(option => option.key)).size !== options.length) throw new ResponseFormatError();
  const notices = array(row.notices, item => {
    const notice = object(item, ["id", "timestamp", "text"]);
    return { id: text(notice.id), timestamp: date(notice.timestamp), text: text(notice.text) };
  });
  return {
    babyId, version: integer(row.version), updatedAt: date(row.updatedAt), options,
    ...(row.firstWeekSummary !== undefined ? { firstWeekSummary: decodeSummary(row.firstWeekSummary) } : {}),
    notices, semantics: text(row.semantics),
  };
}

export function decodePreferenceReceipt(value: unknown, babyId: string, requestId: string): PreferenceMutationReceipt {
  const row = object(value, ["kind", "requestId", "version", "updatedAt", "changedKeys", "text", "preferences"]);
  if (row.kind !== "care_preferences_changed" || text(row.requestId) !== requestId) throw new ResponseFormatError();
  const changedKeys = array(row.changedKeys, preferenceKey);
  if (new Set(changedKeys).size !== changedKeys.length) throw new ResponseFormatError();
  const preferences = decodeCarePreferences(row.preferences, babyId);
  const version = integer(row.version);
  const updatedAt = date(row.updatedAt);
  if (preferences.version !== version || preferences.updatedAt !== updatedAt) throw new ResponseFormatError();
  return { kind: "care_preferences_changed", requestId, version, updatedAt, changedKeys, text: text(row.text), preferences };
}

export function assertPreferenceUpdates(updates: PreferenceUpdate[]): void {
  if (!updates.length || updates.length > allowedKeys.size || new Set(updates.map(update => update.key)).size !== updates.length) throw new ResponseFormatError();
  updates.forEach(update => { preferenceKey(update.key); validatePreferenceValues(update.key, update.values); });
}

export function preferenceUnit(fieldName: PreferenceField): "ml" | "分钟" | "次" {
  return fieldName === "milkAmount" ? "ml" : fieldName === "durationMinutes" ? "分钟" : "次";
}
