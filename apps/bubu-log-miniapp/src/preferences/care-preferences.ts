import Taro from "@tarojs/taro";

export interface NumericRange { min: number; max: number }

export type BreastfeedRateMode = "research" | "custom" | "off";
export type BreastfeedRateSource =
  | "research-heuristic"
  | "user-custom"
  | "user-disabled";

export type BreastfeedRatePreference =
  | { mode: "research" | "custom"; range: NumericRange; source: "research-heuristic" | "user-custom" }
  | { mode: "off"; range: null; source: "user-disabled" };

export interface CarePreferences {
  breastfeedRate: BreastfeedRatePreference;
  /** Daily family/clinician milk reference in ml. `null` uses the age reference. */
  milkReference: NumericRange | null;
  /** Daily family/clinician sleep reference in minutes. `null` uses the age reference. */
  sleepReference: NumericRange | null;
}

export const DEFAULT_CARE_PREFERENCES: CarePreferences = Object.freeze({
  breastfeedRate: Object.freeze({
    mode: "research",
    range: Object.freeze({ min: 5, max: 10 }),
    source: "research-heuristic",
  }),
  milkReference: null,
  sleepReference: null,
});

export interface CarePreferencesIssue { path: string; message: string }
export type CarePreferencesValidationResult =
  | { ok: true; value: CarePreferences }
  | { ok: false; issues: CarePreferencesIssue[] };

export class CarePreferencesValidationError extends Error {
  constructor(public readonly issues: CarePreferencesIssue[]) {
    super("照护环设置不完整或格式不正确。");
    this.name = "CarePreferencesValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value: Record<string, unknown>, path: string, allowed: readonly string[], issues: CarePreferencesIssue[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issues.push({ path: path ? `${path}.${key}` : key, message: "未知设置字段。" });
  }
}

function finiteNumber(value: unknown, path: string, issues: CarePreferencesIssue[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path, message: "必须是有限数字。" });
    return null;
  }
  return value;
}

function validateRange(
  value: unknown,
  path: string,
  bounds: { min: number; max: number },
  issues: CarePreferencesIssue[],
): NumericRange | null {
  if (!isObject(value)) {
    issues.push({ path, message: "必须是包含 min/max 的区间。" });
    return null;
  }
  rejectUnknownFields(value, path, ["min", "max"], issues);
  const min = finiteNumber(value.min, `${path}.min`, issues);
  const max = finiteNumber(value.max, `${path}.max`, issues);
  if (min === null || max === null) return null;
  if (min <= 0 || min < bounds.min || max > bounds.max) {
    issues.push({ path, message: `数值必须在 ${bounds.min}–${bounds.max} 之间。` });
    return null;
  }
  if (min > max) {
    issues.push({ path, message: "区间下限不能大于上限。" });
    return null;
  }
  return { min, max };
}

/**
 * Strict parsing for values submitted by a form or read from local storage.
 * Invalid manual input is returned as field-level errors and is never coerced.
 */
export function validateCarePreferences(input: unknown): CarePreferencesValidationResult {
  const issues: CarePreferencesIssue[] = [];
  if (!isObject(input)) return { ok: false, issues: [{ path: "", message: "设置必须是对象。" }] };
  rejectUnknownFields(input, "", ["breastfeedRate", "milkReference", "sleepReference"], issues);

  const rate = input.breastfeedRate;
  let breastfeedRate: BreastfeedRatePreference | null = null;
  if (!isObject(rate)) {
    issues.push({ path: "breastfeedRate", message: "亲喂速率设置不完整。" });
  } else {
    rejectUnknownFields(rate, "breastfeedRate", ["mode", "range", "source"], issues);
    if (rate.mode === "off") {
      if (rate.range !== null) issues.push({ path: "breastfeedRate.range", message: "关闭估算时区间必须为 null。" });
      if (rate.source !== "user-disabled") issues.push({ path: "breastfeedRate.source", message: "来源标记不正确。" });
      breastfeedRate = { mode: "off", range: null, source: "user-disabled" };
    } else if (rate.mode === "research" || rate.mode === "custom" || rate.mode === "calibrated") {
      const isResearch = rate.mode === "research";
      const expectedSource = isResearch ? "research-heuristic" : rate.mode === "custom" ? "user-custom" : "user-calibrated";
      if (rate.source !== expectedSource) issues.push({ path: "breastfeedRate.source", message: "来源标记不正确。" });
      const range = validateRange(rate.range, "breastfeedRate.range", { min: 0.1, max: 30 }, issues);
      if (range) {
        // Existing local data may contain rates produced by the removed calibration UI.
        // Read them as ordinary custom ranges so their saved min/max remains usable.
        breastfeedRate = {
          mode: isResearch ? "research" : "custom",
          range,
          source: isResearch ? "research-heuristic" : "user-custom",
        };
      }
    } else {
      issues.push({ path: "breastfeedRate.mode", message: "亲喂速率模式不正确。" });
    }
  }

  let milkReference: NumericRange | null = null;
  if (input.milkReference !== null && input.milkReference !== undefined) {
    milkReference = validateRange(input.milkReference, "milkReference", { min: 1, max: 3000 }, issues);
  } else if (!("milkReference" in input)) {
    issues.push({ path: "milkReference", message: "缺少自定义奶量参考设置。" });
  }

  let sleepReference: NumericRange | null = null;
  if (input.sleepReference !== null && input.sleepReference !== undefined) {
    sleepReference = validateRange(input.sleepReference, "sleepReference", { min: 1, max: 1440 }, issues);
  } else if (!("sleepReference" in input)) {
    issues.push({ path: "sleepReference", message: "缺少自定义睡眠参考设置。" });
  }

  if (!breastfeedRate || issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { breastfeedRate, milkReference, sleepReference } };
}

export function validCarePreferencesOrThrow(input: unknown): CarePreferences {
  const result = validateCarePreferences(input);
  if (!result.ok) throw new CarePreferencesValidationError(result.issues);
  return result.value;
}

export interface CarePreferencesScope { backendOrigin: string; babyId: string }
export interface CarePreferencesStorage {
  get(key: string): unknown;
  set(key: string, value: string): void;
  remove(key: string): void;
}
export type CarePreferencesStorageState = "empty" | "valid" | "corrupt";
export interface CarePreferencesReadResult {
  preferences: CarePreferences;
  storageState: CarePreferencesStorageState;
}

export class CarePreferencesScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarePreferencesScopeError";
  }
}

export class CarePreferencesStorageFailure extends Error {
  constructor(public readonly cause?: unknown) {
    super("暂时无法读取或保存照护环设置。");
    this.name = "CarePreferencesStorageFailure";
  }
}

const ORIGIN_PATTERN = /^https?:\/\/[a-zA-Z0-9.\-[\]:]+$/;
const LOCAL_HTTP_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

function normalizeScope(scope: CarePreferencesScope): Required<CarePreferencesScope> {
  const origin = scope.backendOrigin.trim().replace(/\/+$/, "");
  if (!ORIGIN_PATTERN.test(origin) || (origin.startsWith("http://") && !LOCAL_HTTP_PATTERN.test(origin))) {
    throw new CarePreferencesScopeError("照护环设置的 backendOrigin 不合法。");
  }
  const babyId = scope.babyId.trim();
  if (!babyId) throw new CarePreferencesScopeError("照护环设置必须指定宝宝。");
  return { backendOrigin: origin, babyId };
}

export function carePreferencesStorageKey(scope: CarePreferencesScope): string {
  const clean = normalizeScope(scope);
  return `bubu-care-preferences:${clean.backendOrigin}:${encodeURIComponent(clean.babyId)}`;
}

const taroStorage: CarePreferencesStorage = {
  get(key) { return Taro.getStorageSync(key); },
  set(key, value) { Taro.setStorageSync(key, value); },
  remove(key) { Taro.removeStorageSync(key); },
};

/** Reads only this origin+baby preference key. Corrupt persisted JSON safely falls back to defaults. */
export function getCarePreferences(
  scope: CarePreferencesScope,
  storage: CarePreferencesStorage = taroStorage,
): CarePreferencesReadResult {
  const key = carePreferencesStorageKey(scope);
  let raw: unknown;
  try {
    raw = storage.get(key);
  } catch (cause) {
    throw new CarePreferencesStorageFailure(cause);
  }
  if (raw === "" || raw === null || raw === undefined) return { preferences: DEFAULT_CARE_PREFERENCES, storageState: "empty" };
  let decoded: unknown;
  try {
    decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { preferences: DEFAULT_CARE_PREFERENCES, storageState: "corrupt" };
  }
  const result = validateCarePreferences(decoded);
  return result.ok
    ? { preferences: result.value, storageState: "valid" }
    : { preferences: DEFAULT_CARE_PREFERENCES, storageState: "corrupt" };
}

export function saveCarePreferences(
  scope: CarePreferencesScope,
  preferences: CarePreferences,
  storage: CarePreferencesStorage = taroStorage,
): void {
  const key = carePreferencesStorageKey(scope);
  const clean = validCarePreferencesOrThrow(preferences);
  try {
    storage.set(key, JSON.stringify(clean));
  } catch (cause) {
    throw new CarePreferencesStorageFailure(cause);
  }
}

export function resetCarePreferences(
  scope: CarePreferencesScope,
  storage: CarePreferencesStorage = taroStorage,
): void {
  const key = carePreferencesStorageKey(scope);
  try {
    storage.remove(key);
  } catch (cause) {
    throw new CarePreferencesStorageFailure(cause);
  }
}
