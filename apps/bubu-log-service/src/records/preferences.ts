import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { ActorScope, IdentityService, Principal } from "../identity";
import { hash, RecordsRepository } from "./persistence";
import { isCompletionTimeAlias } from "./rules";
import type { ActivityType, CareEvent, Evidence, Field } from "./types";

export const preferenceFields = ["milkAmount", "durationMinutes", "count"] as const;
export type PreferenceField = typeof preferenceFields[number];
export type PreferenceKey = `${ActivityType}.durationMinutes` | `${ActivityType}.count` | "BOTTLE.milkAmount" | "PUMP.milkAmount";

export const preferenceKeys = [
  "BREASTFEED.durationMinutes",
  "BOTTLE.durationMinutes", "BOTTLE.milkAmount",
  "PUMP.durationMinutes", "PUMP.milkAmount",
  "SLEEP.durationMinutes",
  "HEAD_LIFT.durationMinutes",
  "PASSIVE_EXERCISE.durationMinutes",
  "GAS_EXERCISE.durationMinutes",
  "BATH.durationMinutes",
  "OUTDOOR.durationMinutes",
  "EARLY_EDUCATION.durationMinutes",
  "ROLL_OVER.count",
  "PULL_TO_SIT.count",
] as const satisfies readonly PreferenceKey[];
const keySet = new Set<string>(preferenceKeys);

const examplesFor = (key: PreferenceKey): number[] => {
  const [type, field] = key.split(".") as [ActivityType, PreferenceField];
  if (field === "milkAmount") return type === "BOTTLE" ? [60, 90, 120, 150, 180] : [30, 60, 90, 120];
  if (field === "count") return type === "ROLL_OVER" || type === "PULL_TO_SIT" ? [1, 3, 5, 10] : [1, 2, 3, 5];
  if (type === "SLEEP") return [30, 60, 90, 120];
  if (type === "BREASTFEED") return [10, 15, 20, 30];
  if (type === "HEAD_LIFT") return [3, 5, 10, 15];
  if (type === "OUTDOOR") return [15, 30, 60, 90];
  return [5, 10, 15, 30];
};

const ranges: Record<PreferenceField, { min: number; max: number; integer: boolean }> = {
  milkAmount: { min: 0, max: 5000, integer: false },
  durationMinutes: { min: 0, max: 10080, integer: false },
  count: { min: 0, max: 100000, integer: true },
};

export interface PreferenceEntry {
  values: number[];
  source: "manual" | "learned";
  version: number;
  updatedAt: string;
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
interface PreferencesState {
  kind: "care-preferences-state";
  babyId: string;
  version: number;
  updatedAt: string;
  firstEventCreatedAt?: string;
  entries: Partial<Record<PreferenceKey, PreferenceEntry>>;
  firstWeekSummary?: FirstWeekPatternSummary;
}
export interface PreferenceOptionView {
  key: PreferenceKey;
  activityType: ActivityType;
  field: PreferenceField;
  configuredValues: number[];
  effectiveValues: number[];
  source: "manual" | "learned" | "default";
  version: number;
  updatedAt: string;
  usingExampleFallback: boolean;
  examplesAreFacts: false;
  examplesAreRecommendations: false;
}
export interface CarePreferencesView {
  babyId: string;
  version: number;
  updatedAt: string;
  options: PreferenceOptionView[];
  firstWeekSummary?: FirstWeekPatternSummary;
  notices: Array<{ id: string; timestamp: string; text: string }>;
  semantics: string;
}
export interface PreferenceUpdateInput {
  babyId: string;
  requestId: string;
  expectedVersion: number;
  updates: Array<{ key: PreferenceKey; values: number[] }>;
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
interface PreferenceOperation {
  kind: "care-preferences-operation";
  fingerprint: string;
  receipt: PreferenceMutationReceipt;
}
type ProcessingEligibility = (babyId: string, req: PayloadRequest) => Promise<boolean>;

const fail = (code: string, message: string, status = 409): never => { throw new AppError(status, code, message); };
const stateKey = (babyId: string) => `preferences:${hash(babyId)}`;
const operationKey = (scope: ActorScope, requestId: string) => `preferences-operation:${hash([scope.babyId, scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf || "", requestId])}`;
const finiteTime = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? value : undefined;
const evidenceFor = (event: CareEvent, field: Field): Evidence[] => event.evidence.filter(item => item.field === field);
const activityLabels: Record<ActivityType, string> = {
  BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "换尿布", HEAD_LIFT: "抬头",
  PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外", EARLY_EDUCATION: "早教",
  ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补剂", SPIT_UP: "吐奶",
};
const preferenceLabel = (key: PreferenceKey) => {
  const [type, field] = key.split(".") as [ActivityType, PreferenceField];
  return `${activityLabels[type]}${field === "milkAmount" ? "奶量" : field === "durationMinutes" ? "时长" : "次数"}`;
};
const preferenceValue = (key: PreferenceKey, item: PatternValue) => {
  const field = key.split(".")[1] as PreferenceField;
  const unit = field === "milkAmount" ? "ml" : field === "durationMinutes" ? "分钟" : "次";
  return `${item.value} ${unit}（${item.supportCount}次记录）`;
};
const shanghaiDate = (value: string) => {
  const date = new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 10).split("-").map(Number);
  return `${date[0]}年${date[1]}月${date[2]}日`;
};

export class CarePreferencesService {
  constructor(readonly identity: IdentityService, readonly repo: RecordsRepository,
    private readonly processingEligible: ProcessingEligibility = async () => true) {}

  private initial(babyId: string, at: string): PreferencesState {
    return { kind: "care-preferences-state", babyId, version: 0, updatedAt: at, entries: {} };
  }
  private async state(babyId: string, req: PayloadRequest, create = true) {
    const existing = await this.repo.get<PreferencesState>("care-preferences", babyId, stateKey(babyId), req);
    if (existing) return existing;
    const state = this.initial(babyId, new Date(this.identity.now()).toISOString());
    if (create) await this.repo.put("care-preferences", babyId, stateKey(babyId), state, req);
    return state;
  }
  private view(state: PreferencesState): CarePreferencesView {
    const options: PreferenceOptionView[] = preferenceKeys.map(key => {
      const entry = state.entries[key];
      const [activityType, field] = key.split(".") as [ActivityType, PreferenceField];
      const fallback = !entry || entry.values.length === 0;
      return {
        key, activityType, field,
        configuredValues: entry ? [...entry.values] : [],
        effectiveValues: fallback ? examplesFor(key) : [...entry!.values],
        source: entry?.source ?? "default",
        version: entry?.version || 0,
        updatedAt: entry?.updatedAt || state.updatedAt,
        usingExampleFallback: fallback,
        examplesAreFacts: false as const,
        examplesAreRecommendations: false as const,
      };
    });
    const summary = state.firstWeekSummary;
    return {
      babyId: state.babyId, version: state.version, updatedAt: state.updatedAt, options,
      ...(summary ? { firstWeekSummary: summary } : {}),
      notices: summary ? [{ id: summary.id, timestamp: summary.timestamp, text: summary.text }] : [],
      semantics: "示例仅用于手动选择，不代表宝宝实际习惯或建议。",
    };
  }
  private async authorized<T>(principal: Principal, babyId: string, write: boolean,
    action: (scope: ActorScope, req: PayloadRequest) => Promise<T>) {
    return this.identity.executeAuthorized(principal, babyId, write ? "records:write" : "records:read", async (scope, req) => {
      if (write) {
        if (scope.actor.kind !== "caregiver" && scope.actor.kind !== "chat-agent") fail("CAREGIVER_REQUIRED", "常用选项只能由照护者或其委托的聊天助手修改。", 403);
        await this.identity.assertRecordingService(principal, babyId, req);
      }
      return action(scope, req);
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  private validate(update: { key: PreferenceKey; values: number[] }) {
    if (!keySet.has(update.key)) fail("INVALID_PREFERENCE_KEY", "不支持这个常用选项配置。", 400);
    if (new Set(update.values).size !== update.values.length) fail("DUPLICATE_PREFERENCE_VALUE", "同一常用选项中不能有重复数值。", 400);
    const field = update.key.split(".")[1] as PreferenceField;
    const range = ranges[field];
    for (const value of update.values) if (!Number.isFinite(value) || value < range.min || value > range.max || range.integer && !Number.isSafeInteger(value)) {
      fail("INVALID_PREFERENCE_VALUE", field === "count" ? "次数必须是范围内的非负整数。" : "常用数值超出允许范围。", 400);
    }
  }
  async get(principal: Principal, babyId: string) {
    return this.authorized(principal, babyId, false, async (_scope, req) => {
      let state = await this.state(babyId, req);
      if (await this.processingEligible(babyId, req)) state = await this.summarizeIfDue(babyId, state, req);
      return this.view(state);
    });
  }
  /** Shared read shape for later chat-history integration; it contains no private transcript data. */
  async historyData(principal: Principal, babyId: string) { return this.get(principal, babyId); }
  async update(principal: Principal, input: PreferenceUpdateInput): Promise<PreferenceMutationReceipt> {
    return this.authorized(principal, input.babyId, true, async (scope, req) => {
      const fingerprint = hash({ tool: "update-care-preferences", ...input });
      const opKey = operationKey(scope, input.requestId);
      const existing = await this.repo.get<PreferenceOperation>("care-preferences", input.babyId, opKey, req);
      if (existing) {
        if (existing.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT", "同一请求标识不能用于不同的常用选项修改。", 409);
        return existing.receipt;
      }
      if (new Set(input.updates.map(update => update.key)).size !== input.updates.length) fail("DUPLICATE_PREFERENCE_KEY", "一次请求不能重复修改同一个配置项。", 400);
      input.updates.forEach(update => this.validate(update));
      const state = await this.state(input.babyId, req);
      if (state.version !== input.expectedVersion) fail("VERSION_CONFLICT", "常用选项已更新，请重新读取当前版本再修改。", 409);
      const at = new Date(this.identity.now()).toISOString();
      const version = state.version + 1;
      for (const update of input.updates) state.entries[update.key] = { values: [...update.values], source: "manual", version, updatedAt: at };
      state.version = version; state.updatedAt = at;
      await this.repo.put("care-preferences", input.babyId, stateKey(input.babyId), state, req);
      const changedKeys = input.updates.map(update => update.key);
      const receipt: PreferenceMutationReceipt = {
        kind: "care_preferences_changed", requestId: input.requestId, version, updatedAt: at, changedKeys,
        text: `已保存：${changedKeys.map(preferenceLabel).join("、")}。全家共用。`,
        preferences: this.view(state),
      };
      await this.repo.put("care-preferences", input.babyId, opKey, { kind: "care-preferences-operation", fingerprint, receipt } satisfies PreferenceOperation, req);
      return receipt;
    });
  }
  async noteFirstEvent(babyId: string, createdAt: string, req: PayloadRequest) {
    if (!finiteTime(createdAt)) return;
    const state = await this.state(babyId, req);
    if (!state.firstEventCreatedAt || createdAt < state.firstEventCreatedAt) {
      state.firstEventCreatedAt = createdAt;
      await this.repo.put("care-preferences", babyId, stateKey(babyId), state, req);
    }
  }
  private validValues(event: CareEvent, key: PreferenceKey): number[] {
    const [type, field] = key.split(".") as [ActivityType, PreferenceField];
    if (event.facts.type !== type) return [];
    if (type === "BOTTLE" && field === "milkAmount" && event.facts.milkItems?.length) {
      const range = ranges[field];
      return event.facts.milkItems.filter(item => item.milkAmountState === "known" && typeof item.milkAmount === "number" && Number.isFinite(item.milkAmount)
        && item.milkAmount >= range.min && item.milkAmount <= range.max).map(item => item.milkAmount!);
    }
    if (event.states[field] !== "known") return [];
    const value = event.facts[field];
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    const range = ranges[field];
    if (value < range.min || value > range.max || range.integer && !Number.isSafeInteger(value)) return [];
    const evidence = evidenceFor(event, field);
    if (evidence.some(item => item.kind === "default")) return [];
    if (evidence.some(item => !item.confirmed) && !evidence.some(item => item.confirmed && item.kind !== "default")) return [];
    if (field === "durationMinutes") {
      if (event.progress === "ongoing") return [];
      const alias = isCompletionTimeAlias(event.facts, event.evidence);
      if (alias) return [];
    }
    return [value];
  }
  private common(values: number[]): PatternValue[] {
    const counts = new Map<number, { count: number; first: number }>();
    values.forEach((value, index) => {
      const current = counts.get(value);
      counts.set(value, { count: (current?.count || 0) + 1, first: current?.first ?? index });
    });
    return [...counts.entries()].filter(([, support]) => support.count >= 3)
      .sort((left, right) => right[1].count - left[1].count || left[1].first - right[1].first)
      .slice(0, 8).map(([value, support]) => ({ value, supportCount: support.count }));
  }
  private async summarizeIfDue(babyId: string, state: PreferencesState, req: PayloadRequest): Promise<PreferencesState> {
    if (state.firstWeekSummary) return state;
    const events = await this.repo.list<CareEvent>("care-events", babyId, req);
    const first = state.firstEventCreatedAt || events.map(event => finiteTime(event.createdAt)).filter((value): value is string => !!value).sort()[0];
    if (!first) return state;
    const discoveredFirstEvent = !state.firstEventCreatedAt;
    if (discoveredFirstEvent) state.firstEventCreatedAt = first;
    const periodEndMs = Date.parse(first) + 7 * 86400_000;
    if (this.identity.now() < periodEndMs) {
      if (discoveredFirstEvent) await this.repo.put("care-preferences", babyId, stateKey(babyId), state, req);
      return state;
    }
    const periodEnd = new Date(periodEndMs).toISOString();
    const eligible = events.filter(event => event.createdAt >= first && event.createdAt <= periodEnd && event.lifecycle === "active" &&
      event.projection === "synced" && event.duplicateCandidates.length === 0 && event.conflicts.length === 0);
    const sampleCounts: Partial<Record<PreferenceKey, number>> = {};
    const actualOptions: Partial<Record<PreferenceKey, PatternValue[]>> = {};
    const suggestions: Partial<Record<PreferenceKey, PatternValue[]>> = {};
    const at = new Date(this.identity.now()).toISOString();
    const nextVersion = state.version + 1;
    for (const key of preferenceKeys) {
      const values = eligible.flatMap(event => this.validValues(event, key));
      if (values.length) sampleCounts[key] = values.length;
      if (values.length < 3) continue;
      const common = this.common(values);
      if (!common.length) continue;
      actualOptions[key] = common;
      if (state.entries[key]?.source === "manual") suggestions[key] = common;
      else state.entries[key] = { values: common.map(item => item.value), source: "learned", version: nextVersion, updatedAt: at };
    }
    const discovered = Object.entries(actualOptions) as Array<[PreferenceKey, PatternValue[]]>;
    const automaticallyApplied = discovered.filter(([key]) => !suggestions[key]).map(([key, values]) =>
      `${preferenceLabel(key)} ${values.map(item => preferenceValue(key, item)).join("、")}`);
    const manualKeys = preferenceKeys.filter(key => state.entries[key]?.source === "manual");
    const manualSuggestions = (Object.entries(suggestions) as Array<[PreferenceKey, PatternValue[]]>).map(([key, values]) =>
      `${preferenceLabel(key)} ${values.map(item => preferenceValue(key, item)).join("、")}`);
    const statements = [
      automaticallyApplied.length ? `已自动整理：${automaticallyApplied.join("；")}` : "没有自动添加新选项",
      ...(manualKeys.length ? [`家人手动设置已保留：${manualKeys.map(preferenceLabel).join("、")}`] : []),
      ...(manualSuggestions.length ? [`根据记录可参考：${manualSuggestions.join("；")}；仅供参考，未自动覆盖`] : []),
      ...(!discovered.length ? ["这段时间的已确认记录还不足以形成常用数值"] : []),
    ];
    const patternStatement = statements.join("。");
    const range = `${shanghaiDate(first)}至${shanghaiDate(periodEnd)}`;
    const text = `宝宝首周规律总结（${range}）：${patternStatement}。可继续在聊天或设置中调整。`;
    state.version = nextVersion; state.updatedAt = at;
    state.firstWeekSummary = {
      id: `first-week-pattern:${hash(babyId).slice(0, 32)}`, timestamp: at, text, periodStart: first, periodEnd,
      sampleCounts, actualOptions, suggestions, patternStatement, instructions: "可继续聊天调整，也可到设置修改",
    };
    await this.repo.put("care-preferences", babyId, stateKey(babyId), state, req);
    return state;
  }
  async runDueSummaries(): Promise<{ scanned: number; completed: number; skipped: number; failed: number }> {
    const rows = await this.identity.store.payload.find({ collection: "care-events", select: { babyId: true }, pagination: false, limit: 0, depth: 0, overrideAccess: true });
    const babyIds = [...new Set(rows.docs.map(row => String(row.babyId)).filter(Boolean))].sort();
    let completed = 0, skipped = 0, failed = 0;
    for (const babyId of babyIds) {
      try {
        const outcome = await this.identity.exclusive(async () => this.identity.store.transaction(async req => {
          if (!await this.processingEligible(babyId, req)) return "skipped" as const;
          const before = await this.state(babyId, req);
          if (before.firstWeekSummary) return "skipped" as const;
          const after = await this.summarizeIfDue(babyId, before, req);
          return after.firstWeekSummary ? "completed" as const : "skipped" as const;
        }));
        if (outcome === "completed") completed++; else skipped++;
      } catch { failed++; }
    }
    return { scanned: babyIds.length, completed, skipped, failed };
  }
}
