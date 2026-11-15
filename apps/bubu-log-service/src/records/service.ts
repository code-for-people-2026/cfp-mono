import { AppError } from "../contracts";
import type { ActorScope, Principal, IdentityService } from "../identity";
import type { PayloadRequest } from "payload";
import { RecordsRepository, hash } from "./persistence";
import { CarePreferencesService } from "./preferences";
import { durationRequiredTypes, evaluateEvent, timeConflicts } from "./rules";
import { affectedDates, computeStatistics, chinaDate, activityInDate, isActivityOngoing } from "./statistics";
import type { CareEvent, EventInput, Facts, Field, RulePatch, LegacyActivity, LegacyRecordsBackend, MilkItemAnswer, PendingQuestion, RecordActivityNotice, RecordReceipt, SourceRef } from "./types";
import type { PendingBatchInput } from "./schemas";

type AttachmentValidator = (scope: ActorScope, req: PayloadRequest, id: string) => Promise<unknown>;
interface Projection { eventId: string; version: number; expected: LegacyActivity | null; desired: LegacyActivity | null }
interface Revision { id: string; eventId: string; babyId: string; version: number; before: CareEvent | null; after: CareEvent; actor: ActorScope["actor"]; at: string }
interface Operation {
  key: string; requestId: string; babyId: string; fingerprint: string; actor: ActorScope["actor"];
  eventIds: string[]; projections: Projection[]; dates: string[];
  status: "pending" | "done" | "conflict"; error?: string; receipt?: RecordReceipt;
  noticeEligible?: boolean; activityNotice?: RecordActivityNotice;
}
/** Public collector recovery contract: expose durable state, never persisted arguments. */
export interface CollectorOperationSnapshot { status: "missing" | "pending" | "conflict" | "done" }
/** Exact collector identity attached to a collector job; no session or operator identity is inferred. */
export interface CollectorOperationActor {
  kind: "collector"; babyId: string; groupId: string; subjectId: string;
}
function fail(code: string, message: string, status = 409): never { throw new AppError(status, code, message); }
const sourceKey = (source: SourceRef) => hash([source.kind, source.accountId, source.conversationId, source.messageId, source.eventKey]);
const sourceLinkKey = (babyId:string,source:SourceRef) => hash([babyId,sourceKey(source)]);
const pointTypes = new Set(["DIAPER", "SUPPLEMENT", "SPIT_UP", "ROLL_OVER", "PULL_TO_SIT"]);
const completionTimeTypes = new Set(["BOTTLE", "PUMP", "BATH"]);
const idFor = (value: string) => `bubu-${hash(value).slice(0, 40)}`;
const legacyFacts = (activity: LegacyActivity): Facts => Object.fromEntries(Object.entries(activity).filter(([field]) => !["id", "babyId", "createdAt", "updatedAt"].includes(field)));
const recordActivityLabels: Record<string, string> = { BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "换尿布", HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外活动", EARLY_EDUCATION: "早教", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补剂", SPIT_UP: "吐奶" };
const overlapKey = (left:Facts,right:Facts) => hash([left.type,left.startTime,left.endTime,right.type,right.startTime,right.endTime]);
const milkDescriptionNote = (value: string) => `奶品原话：${value}`;
const milkItemLabel = (item: NonNullable<Facts["milkItems"]>[number]) => item.milkDescription || (item.milkSource === "FORMULA" ? "奶粉" : item.milkSource === "BREAST_MILK" ? "母乳" : "奶品待补");

/** The sidecar owns intent/revisions; the existing Activity remains the projected fact.
 * A committed operation is deliberately separate from the remote mutation transaction. */
export class RecordsService {
  readonly repo: RecordsRepository;
  readonly preferences: CarePreferencesService;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly identity: IdentityService, readonly legacy: LegacyRecordsBackend,
    private readonly validateAttachment: AttachmentValidator = async () => { throw new AppError(503, "ATTACHMENTS_UNAVAILABLE", "附件服务未配置。"); },
    preferenceEligibility?: (babyId: string, req: PayloadRequest) => Promise<boolean>) {
    this.repo = new RecordsRepository(identity.store.payload);
    this.preferences = new CarePreferencesService(identity, this.repo, preferenceEligibility);
  }
  private async authorized<T>(principal: Principal, babyId: string, write: boolean, action: (scope: ActorScope, req: PayloadRequest) => Promise<T>) {
    return this.identity.executeAuthorized(principal, babyId, write ? "records:write" : "records:read", async (scope, req) => {
      if (write) await this.identity.assertRecordingService(principal, babyId, req);
      return action(scope, req);
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  private async beforeProjection(principal: Principal, babyId: string, req: PayloadRequest) {
    await this.identity.authorize(principal, babyId, "records:write", principal.kind === "collector" ? principal.groupId : undefined);
    await this.identity.assertRecordingService(principal, babyId, req);
  }
  private operationKey(scope: ActorScope, requestId: string) { return hash([scope.babyId, scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf || "", scope.groupId || "", requestId]); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action); this.queue = result.catch(() => undefined); return result;
  }
  private validateSources(scope: ActorScope, sources: SourceRef[]) {
    for (const source of sources) {
      if (scope.actor.kind === "collector") {
        if (source.kind !== "wechat" || !source.groupId || source.groupId !== scope.groupId) fail("SOURCE_SCOPE_MISMATCH", "来源群与采集授权不一致。", 403);
        if (source.conversationId!==scope.groupId && `wechat:${source.accountId}:${source.conversationId}`!==scope.groupId) fail("SOURCE_SCOPE_MISMATCH", "来源账号和会话与采集授权不一致。",403);
      } else if (source.kind === "wechat" || source.groupId) fail("SOURCE_SCOPE_MISMATCH", "群来源只能由已授权采集任务提交。", 403);
    }
  }
  private async event(scope: ActorScope, eventId: string, req: PayloadRequest): Promise<CareEvent> {
    const saved = await this.repo.get<CareEvent>("care-events", scope.babyId, eventId, req);
    if (saved) {
      if (!this.inScope(scope, saved)) fail("EVENT_GROUP_FORBIDDEN", "记录不属于此采集群。", 403);
      return saved;
    }
    if (scope.actor.kind === "collector") fail("EVENT_GROUP_FORBIDDEN", "采集身份只能操作本群已关联的记录。", 403);
    const legacy = await this.legacy.getActivity(scope.babyId, eventId);
    if (!legacy) return fail("EVENT_NOT_FOUND", "记录不存在或无权访问。", 404);
    return this.fromLegacy(scope,legacy);
  }
  private fromLegacy(scope:ActorScope,legacy:LegacyActivity):CareEvent {
    const facts = legacyFacts(legacy);
    const now = new Date(this.identity.now()).toISOString();
    return { id: legacy.id, legacyId: legacy.id, babyId: scope.babyId, version: 1, facts,
      states: Object.fromEntries(Object.entries(facts).filter(([,v]) => v !== null && v !== undefined).map(([k]) => [k, "known"])),
      progress: legacy.endTime ? "ended" : "unknown", evidence: [], missing: [], conflicts: [], complete: true,
      lifecycle: "active", duplicateCandidates: [], sources: [], attachmentIds: [], actor: scope.actor,
      projection: "synced", projected: legacy, createdAt: legacy.createdAt || now, updatedAt: legacy.updatedAt || now };
  }
  private checkVersion(event: CareEvent, version: number, allowInactive = false) {
    if (event.version !== version) fail("VERSION_CONFLICT", "记录已更新，请重新读取当前记录再修改。");
    if (!allowInactive && event.lifecycle !== "active") fail("EVENT_INACTIVE", "记录已撤销或合并，迟到的回答不会恢复它。");
    if (event.projection === "pending") fail("PROJECTION_PENDING", "上次保存仍待恢复，请先查询并恢复原请求。");
    if (event.projection === "conflict") fail("PROJECTION_CONFLICT", "旧记录已变化，请先核对并接受旧记录的最新事实。");
  }
  private inScope(scope: ActorScope, event: CareEvent) {
    return scope.actor.kind !== "collector" || (event.sources.some(source => source.kind === "wechat" && source.groupId === scope.groupId)
      && !event.sources.some(source => source.kind === "wechat" && source.groupId !== scope.groupId));
  }
  /** Re-evaluate only current completion policy; persisted facts, states and evidence stay authoritative. */
  private currentEvent(event: CareEvent): CareEvent {
    const current = evaluateEvent({ facts: event.facts, states: event.states, progress: event.progress,
      intent: event.intent, evidence: event.evidence }, { now: this.identity.now() });
    return { ...event, missing: current.missing, complete: !event.conflicts.length && !event.duplicateCandidates.length && current.complete };
  }
  private isUnsupportedScalarBottle(event: CareEvent): boolean {
    return event.facts.type === "BOTTLE" && !event.facts.milkItems?.length;
  }
  /** Historical scalar BOTTLE facts are intentionally read-only. Re-running
   * current bottle rules would discard their scalar milk facts, not convert them. */
  private assertBottleEvaluationSupported(event: CareEvent) {
    if (this.isUnsupportedScalarBottle(event)) {
      fail("LEGACY_BOTTLE_ITEMS_UNAVAILABLE", "旧瓶喂记录不支持按新奶品明细规则修改；原记录已保留。", 409);
    }
  }
  /** Add canonical bottle details only while the legacy row still exactly
   * matches the projection we wrote. Shared by queries and persisted stats. */
  private enrichCanonicalActivities(activities: LegacyActivity[], events: CareEvent[]): LegacyActivity[] {
    const byLegacyId = new Map(events.map(event => [event.legacyId, event]));
    return activities.map(activity => {
      const event = byLegacyId.get(activity.id);
      const exactProjection = !!event?.projected && hash(activity) === hash(event.projected);
      return event?.projection === "synced" && event.lifecycle === "active" && exactProjection && event.facts.milkItems?.length
        ? { ...activity, milkItems: event.facts.milkItems }
        : activity;
    });
  }
  /** A persisted question remains visible only for fields still required by current rules (or a real conflict/duplicate). */
  private effectiveQuestion(question: PendingQuestion, event: CareEvent): PendingQuestion | null {
    if (this.isUnsupportedScalarBottle(event)) {
      if (!question.conflicts.length && !question.duplicateCandidates.length) return null;
      return { ...question, fields: [] };
    }
    const current = this.currentEvent(event);
    const fields = question.fields.filter(field => current.missing.includes(field));
    if (!fields.length && !question.conflicts.length && !question.duplicateCandidates.length) return null;
    return { ...question, fields };
  }
  private effectiveQuestions(scope: ActorScope | null, events: CareEvent[], questions: PendingQuestion[], eventId?: string) {
    const byId = new Map(events.filter(event => !scope || this.inScope(scope, event)).map(event => [event.id, event]));
    return questions.flatMap(question => {
      if (question.state !== "open" || (eventId && question.eventId !== eventId)) return [];
      const event = byId.get(question.eventId);
      if (!event || event.lifecycle !== "active") return [];
      const effective = this.effectiveQuestion(question, event);
      return effective ? [effective] : [];
    });
  }
  private async recheck(scope: ActorScope, before: CareEvent, after: CareEvent, req: PayloadRequest, overlay?: Map<string, CareEvent>) {
    const identityChanged = ["type", "startTime", "milkAmount", "milkItems"].some(field => hash(before.facts[field as Field]) !== hash(after.facts[field as Field]));
    if (identityChanged) after.distinctFrom = [];
    const legacy = await this.legacy.listActivities(scope.babyId);
    const saved = await this.repo.list<CareEvent>("care-events", scope.babyId, req);
    const stagedIds = new Set(overlay?.keys() ?? []);
    const legacyById = new Map(legacy.map(row => [row.id, row]));
    const managed = saved.map(event => overlay?.get(event.id) ?? event);
    for (const event of overlay?.values() ?? []) if (!managed.some(candidate => candidate.id === event.id)) managed.push(event);
    const aliases = new Set(managed.map(event => event.legacyId));
    const candidates = [
      ...managed.filter(event => event.lifecycle === "active").map(event => ({
        id: event.id,
        legacyId: event.legacyId,
        // A staged event replaces both its persisted managed version and its
        // legacy alias. Untouched managed events still observe current legacy
        // drift, while retaining the canonical id used by overlap approvals.
        facts: stagedIds.has(event.id) ? event.facts : legacyById.get(event.legacyId) ?? event.facts,
      })),
      ...legacy.filter(row => !aliases.has(row.id)).map(row => ({ id: row.id, legacyId: row.id, facts: row })),
    ].filter(candidate => candidate.id !== after.id && candidate.id !== after.legacyId && candidate.legacyId !== after.id && candidate.legacyId !== after.legacyId);
    after.duplicateCandidates = [...new Set(candidates.filter(candidate => !after.distinctFrom?.includes(candidate.id) && this.possibleDuplicate(after.facts,candidate.facts)).map(candidate=>candidate.id))];
    after.conflicts = after.conflicts.filter(issue => !issue.relatedEventId);
    if (!after.duplicateCandidates.length) after.conflicts.push(...candidates.filter(candidate=>!after.distinctFrom?.includes(candidate.id)&&after.confirmedOverlaps?.[candidate.id]!==overlapKey(after.facts,candidate.facts)).flatMap(candidate=>timeConflicts(after.facts,candidate.facts).map(issue=>({...issue,relatedEventId:candidate.id}))));
    const current = this.currentEvent(after);
    after.missing = current.missing; after.complete = current.complete;
  }
  /** Apply an authenticated source timestamp only when creating a new event.
   * Follow-up sources are provenance, never a replacement clock for the event. */
  private anchorNewEvent(entry: EventInput): EventInput {
    const sources = [...(entry.sources || [])].sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
    const source = sources.at(-1);
    if (!source) return entry;
    const facts = { ...entry.facts };
    const evidence = [...(entry.evidence || [])];
    const hasStart = !!facts.startTime; const hasEnd = !!facts.endTime; const hasDuration = facts.durationMinutes !== undefined;
    if ((hasStart && hasEnd) || (hasDuration && (hasStart || hasEnd))) return entry;
    let field: "startTime" | "endTime";
    if (entry.progress === "ongoing") {
      if (hasStart || hasEnd) return entry;
      field = "startTime";
    } else if (facts.type && durationRequiredTypes.has(facts.type)) {
      if (hasEnd || (hasStart && entry.progress !== "ended")) return entry;
      field = "endTime";
    } else if (hasDuration || (facts.type && completionTimeTypes.has(facts.type))) {
      if (hasStart || hasEnd) return entry;
      field = "endTime";
    } else {
      if (hasStart || hasEnd) return entry;
      field = "startTime";
    }
    if (entry.states?.[field] === "unknown") return entry;
    facts[field] = source.sentAt;
    evidence.push({ field, kind: "default", sourceKey: sourceKey(source), detail: `source sentAt used as ${field}`, confirmed: true });
    return { ...entry, facts, evidence };
  }
  private apply(event: CareEvent, patch: RulePatch): CareEvent {
    this.assertBottleEvaluationSupported(event);
    const facts = { ...event.facts, ...patch.facts };
    if (patch.milkItemAnswers?.length) facts.milkItems = this.mergeMilkItemAnswers(event, patch.milkItemAnswers);
    const states = { ...event.states, ...patch.states };
    // An untyped, newly captured feeding may already contain genuinely reported
    // scalar milk facts. When its pending type is clarified as BOTTLE, mint the
    // first stable line item before bottle normalization removes scalar inputs.
    // This deliberately does not convert an already-typed historical BOTTLE.
    const initializedBottleItem = event.facts.type === undefined && patch.facts.type === "BOTTLE" && !facts.milkItems?.length;
    if (initializedBottleItem) {
      const item = {
        id: `milk-${hash([event.id, "initial-bottle-item"]).slice(0, 16)}`,
        ...(facts.milkSource !== undefined ? { milkSource: facts.milkSource } : {}),
        ...(facts.milkDescription !== undefined ? { milkDescription: facts.milkDescription } : {}),
        ...(typeof facts.milkAmount === "number" ? { milkAmount: facts.milkAmount } : {}),
        milkSourceState: facts.milkSource !== undefined || facts.milkDescription !== undefined
          ? "known" as const : states.milkSource === "unknown" || states.milkDescription === "unknown" ? "unknown" as const : "pending" as const,
        milkAmountState: typeof facts.milkAmount === "number"
          ? "known" as const : states.milkAmount === "unknown" ? "unknown" as const : "pending" as const,
      };
      facts.milkItems = [item];
      delete facts.milkSource; delete facts.milkDescription; delete facts.milkAmount;
      delete states.milkSource; delete states.milkDescription; delete states.milkAmount;
    }
    const changed = new Set(Object.keys(patch.facts));
    const moveOriginalAnchorToEnd = changed.has("type") && !!facts.type && durationRequiredTypes.has(facts.type) &&
      patch.progress !== "ongoing" && !changed.has("startTime") && !changed.has("endTime") && !event.facts.endTime &&
      event.evidence.some(item => item.field === "startTime" && item.kind === "default" && item.detail === "source sentAt used as startTime");
    if (moveOriginalAnchorToEnd) { facts.endTime = facts.startTime; delete facts.startTime; }
    if ((changed.has("startTime") || changed.has("endTime")) && !changed.has("durationMinutes")) delete facts.durationMinutes;
    const calculated = (field: Field) => event.evidence.some(item => item.field === field && item.kind === "calculated");
    if (changed.has("durationMinutes")) {
      if (!changed.has("endTime") && calculated("endTime")) delete facts.endTime;
      if (!changed.has("startTime") && calculated("startTime")) delete facts.startTime;
    }
    if (changed.has("startTime") && !changed.has("endTime") && calculated("endTime")) delete facts.endTime;
    if (changed.has("endTime") && !changed.has("startTime") && calculated("startTime")) delete facts.startTime;
    if (moveOriginalAnchorToEnd) { delete states.startTime; states.endTime = "known"; }
    if (facts.durationMinutes === undefined && !changed.has("durationMinutes") &&
      states.durationMinutes !== "unknown" && states.durationMinutes !== "not_yet") delete states.durationMinutes;
    if (!facts.startTime && states.startTime !== "unknown" && states.startTime !== "not_yet") delete states.startTime;
    if (!facts.endTime && states.endTime !== "unknown" && states.endTime !== "not_yet") delete states.endTime;
    for (const key of Object.keys(patch.facts) as Field[]) {
      if (initializedBottleItem && (key === "milkAmount" || key === "milkSource" || key === "milkDescription")) continue;
      if (!patch.states?.[key]) states[key] = patch.facts[key] == null ? "pending" : "known";
    }
    const addressedEvidence = new Set<string>([
      ...Object.keys(patch.facts),
      ...Object.keys(patch.states ?? {}),
      ...(patch.evidence ?? []).map(item => item.field),
    ]);
    if (changed.has("durationMinutes")) {
      if (!facts.startTime && !moveOriginalAnchorToEnd) addressedEvidence.add("startTime");
      if (!facts.endTime) addressedEvidence.add("endTime");
    }
    if (changed.has("startTime") || changed.has("endTime")) addressedEvidence.add("durationMinutes");
    const evidence = [
      ...event.evidence.filter(item => !addressedEvidence.has(item.field)).map(item => moveOriginalAnchorToEnd && item.field === "startTime" && item.kind === "default"
        ? { ...item, field: "endTime" as const, detail: "source sentAt used as endTime" } : item),
      ...(patch.evidence ?? []),
    ];
    const evaluation = evaluateEvent({ facts, states, progress: patch.progress ?? (changed.has("endTime") || changed.has("durationMinutes") ? "ended" : event.progress),
      intent: patch.intent ?? event.intent, evidence }, { now: this.identity.now() });
    return { ...event, ...evaluation, ...(patch.intent ? { intent: patch.intent } : {}) };
  }
  private mergeMilkItemAnswers(event: CareEvent, answers: MilkItemAnswer[]) {
    if (event.facts.type !== "BOTTLE" || !event.facts.milkItems?.length) fail("MILK_ITEMS_REQUIRED", "当前记录没有可补充的奶品明细。", 400);
    const ids = new Set<string>();
    const items = event.facts.milkItems.map(item => ({ ...item }));
    for (const answer of answers) {
      if (ids.has(answer.milkItemId)) fail("DUPLICATE_MILK_ITEM_ANSWER", "一次提交不能重复修改同一奶品明细。", 400);
      ids.add(answer.milkItemId);
      const item = items.find(candidate => candidate.id === answer.milkItemId);
      if (!item) fail("MILK_ITEM_NOT_FOUND", "奶品明细已变化，请刷新后重试。", 409);
      const facts = answer.facts || {}, states = answer.states || {};
      const amountTouched = Object.prototype.hasOwnProperty.call(facts, "milkAmount") || states.milkAmountState !== undefined;
      const sourceTouched = facts.milkSource !== undefined || facts.milkDescription !== undefined || states.milkSourceState !== undefined;
      if (amountTouched) {
        if (item.milkAmountState !== "pending") fail("MILK_ITEM_FIELD_LOCKED", "只能补充当前仍缺少的奶量，不能覆盖已知或明确未知的明细。", 409);
        if (states.milkAmountState === "pending") fail("MILK_ITEM_ANSWER_PENDING", "提交答案不能继续标记为待补。", 400);
        if (states.milkAmountState === "unknown") { delete item.milkAmount; item.milkAmountState = "unknown"; }
        else if (typeof facts.milkAmount === "number") { item.milkAmount = facts.milkAmount; item.milkAmountState = "known"; }
        else fail("MILK_ITEM_AMOUNT_REQUIRED", "奶量答案必须提供实际数值或明确未知。", 400);
      }
      if (sourceTouched) {
        if (item.milkSourceState !== "pending") fail("MILK_ITEM_FIELD_LOCKED", "只能补充当前仍缺少的奶品，不能覆盖已知或明确未知的明细。", 409);
        if (states.milkSourceState === "pending") fail("MILK_ITEM_ANSWER_PENDING", "提交答案不能继续标记为待补。", 400);
        if (states.milkSourceState === "unknown") { delete item.milkSource; delete item.milkDescription; item.milkSourceState = "unknown"; }
        else if (facts.milkSource !== undefined || facts.milkDescription !== undefined) {
          if (facts.milkSource !== undefined && facts.milkDescription !== undefined) fail("AMBIGUOUS_MILK_ITEM_SOURCE", "奶品原话不能同时被猜测为奶粉或母乳。", 400);
          if (facts.milkSource !== undefined) { item.milkSource = facts.milkSource; delete item.milkDescription; }
          else { item.milkDescription = facts.milkDescription; delete item.milkSource; }
          item.milkSourceState = "known";
        } else fail("MILK_ITEM_SOURCE_REQUIRED", "奶品答案必须提供标准奶源、原话奶品或明确未知。", 400);
      }
      if (!amountTouched && !sourceTouched) fail("MILK_ITEM_ANSWER_EMPTY", "奶品明细答案不能为空。", 400);
    }
    return items;
  }
  private validatePendingPatch(before: CareEvent, allowed: Set<Field>, patch: RulePatch) {
    if (patch.intent !== undefined || patch.evidence?.length) fail("BATCH_FIELD_MISMATCH", "待补答案不能改写事件意图或证据。", 400);
    if (before.facts.type !== "BOTTLE") {
      if (patch.milkItemAnswers?.length) fail("BATCH_FIELD_MISMATCH", "只有瓶喂奶品明细可以使用逐项答案。", 400);
      return;
    }
    if (patch.facts.milkItems !== undefined || patch.facts.milkAmount !== undefined || patch.facts.milkSource !== undefined || patch.facts.milkDescription !== undefined ||
      patch.states?.milkItems !== undefined || patch.states?.milkAmount !== undefined || patch.states?.milkSource !== undefined || patch.states?.milkDescription !== undefined) {
      fail("BATCH_MILK_ITEM_TAMPER", "瓶喂待补只能按明细 ID 提交当前缺项，不能替换整组明细或根级派生字段。", 400);
    }
    for (const answer of patch.milkItemAnswers || []) {
      const item = before.facts.milkItems?.find(candidate => candidate.id === answer.milkItemId);
      if (!item) fail("MILK_ITEM_NOT_FOUND", "奶品明细已变化，请刷新后重试。", 409);
      const amountTouched = Object.prototype.hasOwnProperty.call(answer.facts || {}, "milkAmount") || answer.states?.milkAmountState !== undefined;
      const sourceTouched = answer.facts?.milkSource !== undefined || answer.facts?.milkDescription !== undefined || answer.states?.milkSourceState !== undefined;
      if (amountTouched && (!allowed.has("milkAmount") || item.milkAmountState !== "pending")) fail("BATCH_MILK_ITEM_TAMPER", "答案修改了当前问题未要求的奶量明细。", 400);
      if (sourceTouched && (!allowed.has("milkSource") || item.milkSourceState !== "pending")) fail("BATCH_MILK_ITEM_TAMPER", "答案修改了当前问题未要求的奶品明细。", 400);
    }
  }
  private validateMilkItemUpdate(before: CareEvent, patch: RulePatch) {
    if (before.facts.type === "BOTTLE" && ["milkAmount", "milkSource", "milkDescription"]
      .some(field => Object.prototype.hasOwnProperty.call(patch.facts, field))) {
      fail("BOTTLE_DERIVED_ROOT_INPUT", "瓶喂根级奶量和奶品是明细派生结果，不能直接修改。", 400);
    }
    if (before.facts.type === "BOTTLE" && (patch.states?.milkItems !== undefined || patch.states?.milkAmount !== undefined ||
      patch.states?.milkSource !== undefined || patch.states?.milkDescription !== undefined)) {
      fail("MILK_ITEM_STATE_TAMPER", "瓶喂奶品明细及其派生状态只能由逐项事实决定，不能用根级状态删除或覆盖。", 400);
    }
    if (patch.milkItemAnswers?.length && patch.facts.milkItems !== undefined) {
      fail("MILK_ITEM_UPDATE_AMBIGUOUS", "一次修改不能同时替换奶品明细和提交逐项待补答案。", 400);
    }
    const next = patch.facts.milkItems;
    if (next === undefined) return;
    const current = before.facts.milkItems;
    if (before.facts.type === "BOTTLE" && !current?.length) {
      fail("LEGACY_BOTTLE_ITEMS_UNAVAILABLE", "旧瓶喂记录不能通过新模型原地转换；请保留原记录。", 409);
    }
    if (!current?.length) return;
    if (next.length < current.length || current.some((item, index) => next[index]?.id !== item.id)) {
      fail("MILK_ITEM_IDENTITY_CHANGED", "修改瓶喂餐次时必须按原顺序保留已有奶品明细 ID；只能追加同餐明细。", 409);
    }
  }
  private desired(event: CareEvent): LegacyActivity | null {
    if (event.lifecycle !== "active" || event.duplicateCandidates.length || !event.facts.type || !event.facts.startTime || event.conflicts.length) return null;
    const facts = { ...event.facts };
    if (facts.milkItems?.length) {
      const sources = [...new Set(facts.milkItems.map(item => item.milkSource).filter((value): value is NonNullable<typeof value> => !!value))];
      if (sources.length === 1 && facts.milkItems.every(item => item.milkSource === sources[0] && !item.milkDescription)) facts.milkSource = sources[0];
      else delete facts.milkSource;
    } else if (facts.milkDescription) {
      const literal = milkDescriptionNote(facts.milkDescription);
      const notes = facts.notes?.trim();
      facts.notes = notes === literal || notes?.endsWith(`\n${literal}`) ? notes : notes ? `${notes}\n${literal}` : literal;
    }
    delete facts.milkItems; delete facts.milkDescription;
    delete facts.preparedMilkAmount; delete facts.remainingMilkAmount; delete facts.sameBottle; delete facts.durationMinutes; delete facts.reportedIntake;
    return { ...facts, id: event.legacyId, babyId: event.babyId, type: event.facts.type, startTime: event.facts.startTime,
      ...(pointTypes.has(event.facts.type) ? { endTime: event.facts.startTime } : {}) };
  }
  private async saveQuestion(event: CareEvent, req: PayloadRequest) {
    const key = `question:${event.id}`;
    const old = await this.repo.get<PendingQuestion>("care-questions", event.babyId, key, req);
    const fields = event.missing.filter(field => event.states[field] !== "unknown" && event.states[field] !== "not_yet");
    const open = event.lifecycle === "active" && (fields.length > 0 || event.conflicts.length > 0 || event.duplicateCandidates.length > 0);
    const question: PendingQuestion = { id: key, babyId: event.babyId, eventId: event.id, version: (old?.version || 0) + 1,
      eventVersion: event.version, fields, conflicts: event.conflicts, duplicateCandidates: event.duplicateCandidates,
      state: open ? "open" : event.complete || event.lifecycle !== "active" ? "resolved" : "dismissed", updatedAt: event.updatedAt };
    await this.repo.put("care-questions", event.babyId, key, question, req);
  }
  private async persist(scope: ActorScope, before: CareEvent | null, event: CareEvent, req: PayloadRequest): Promise<Projection | undefined> {
    if(hash([...(before?.attachmentIds||[])].sort())!==hash([...event.attachmentIds].sort())) {
      if(!scope.permissions.includes("media:write"))fail("MEDIA_FORBIDDEN","没有关联图片的权限。",403);
      for(const id of event.attachmentIds)await this.validateAttachment(scope,req,id);
    }
    event.actor = scope.actor;
    event.updatedAt = new Date(this.identity.now()).toISOString();
    event.version = before ? before.version + 1 : 1;
    const desired = this.desired(event);
    // Removing a previously projected fact is allowed only for an explicit retraction/merge.
    // An invalid edit remains a candidate revision and does not silently erase the old fact.
    const shouldWrite = !!desired || (event.lifecycle !== "active" && !!event.projected);
    event.projection = shouldWrite ? "pending" : "candidate";
    const revision: Revision = { id: `revision:${event.id}:${event.version}`, eventId: event.id, babyId: event.babyId, version: event.version,
      before, after: structuredClone(event), actor: scope.actor, at: event.updatedAt };
    await this.repo.put("care-revisions", event.babyId, revision.id, revision, req);
    await this.repo.put("care-events", event.babyId, event.id, event, req);
    await this.saveQuestion(event, req);
    for (const source of event.sources) {
      const key = sourceLinkKey(event.babyId,source);
      const link = await this.repo.get<{eventId: string}>("care-source-links", event.babyId, key, req);
      if (link && link.eventId !== event.id && link.eventId !== event.mergedInto) {
        const linked = await this.repo.get<CareEvent>("care-events", event.babyId, link.eventId, req);
        if (linked?.lifecycle !== "merged" || linked.mergedInto !== event.id) fail("SOURCE_ALREADY_LINKED", "来源已关联另一条记录，请先核对。");
      }
      if (!link) await this.repo.put("care-source-links", event.babyId, key, { eventId: event.id, source }, req);
    }
    return shouldWrite ? { eventId: event.id, version: event.version, expected: before?.projected || null, desired } : undefined;
  }
  private async mutate(principal: Principal, babyId: string, requestId: string, input: unknown,
    prepare: (scope: ActorScope, req: PayloadRequest) => Promise<Array<{before: CareEvent | null; after: CareEvent; unchanged?: boolean}>>): Promise<RecordReceipt> {
    return this.serial(async () => {
      const operation = await this.authorized(principal, babyId, true, async (scope, req) => {
        const key = this.operationKey(scope, requestId), fingerprint = hash(input);
        const old = await this.repo.get<Operation>("care-operations", babyId, key, req);
        if (old) {
          if (old.fingerprint !== fingerprint) fail("IDEMPOTENCY_CONFLICT", "同一请求标识不能用于不同内容。");
          return old;
        }
        const changes = await prepare(scope, req);
        await this.beforeProjection(principal, babyId, req);
        const projections: Projection[] = [];
        for (const change of changes) {
          if (change.unchanged) continue;
          const action = await this.persist(scope, change.before, change.after, req);
          if (action) projections.push(action);
        }
        const next: Operation = { key, requestId, babyId, fingerprint, actor: scope.actor,
          eventIds: [...new Set(changes.map(change => change.after.id))], projections,
          dates: affectedDates(changes.flatMap(change => [change.before?.projected || {}, change.after.facts])), status: "pending",
          noticeEligible: changes.some(change => !change.unchanged) };
        await this.repo.put("care-operations", babyId, key, next, req);
        return next;
      });
      if (operation.receipt && operation.status !== "pending") return operation.receipt;
      return this.flush(principal, operation);
    });
  }
  private async flush(principal: Principal, operation: Operation): Promise<RecordReceipt> {
    const outcome = await this.authorized(principal, operation.babyId, true, async (scope, req) => {
      const op = (await this.repo.get<Operation>("care-operations", operation.babyId, operation.key, req))!;
      let interruption: AppError | undefined;
      try {
        for (const action of op.projections) {
          const event = (await this.repo.get<CareEvent>("care-events", op.babyId, action.eventId, req))!;
          // Only a projected revision can be edited. A newer revision means this
          // older action already succeeded; never replay it over later intent.
          if(event.version!==action.version)continue;
          if (event.projection === "synced") continue;
          await this.beforeProjection(principal, op.babyId, req);
          const projected = await this.legacy.writeActivity(op.babyId, event.legacyId, action.desired, action.expected);
          event.projected = projected; event.projection = "synced";
          await this.repo.put("care-events", op.babyId, event.id, event, req);
        }
        if (op.projections.length) {
          const legacyActivities = await this.legacy.listActivities(op.babyId);
          const events = await this.repo.list<CareEvent>("care-events", op.babyId, req);
          const activities = this.enrichCanonicalActivities(legacyActivities, events);
          for (const date of op.dates) {
            await this.beforeProjection(principal, op.babyId, req);
            await this.legacy.saveDailyStats(op.babyId, date, computeStatistics(activities, date, events, this.identity.now()).metrics);
          }
        }
        op.status = "done"; delete op.error;
      } catch (error) {
        if (error instanceof AppError && (error.retryable === true || error.status === 401 || error.status === 403)) interruption = error;
        op.status = !interruption && error instanceof AppError && error.status === 409 ? "conflict" : "pending";
        op.error = error instanceof AppError ? error.code : "PROJECTION_UNAVAILABLE";
        if (op.status === "conflict") for (const action of op.projections) {
          const event = (await this.repo.get<CareEvent>("care-events", op.babyId, action.eventId, req))!;
          if (event.version===action.version&&event.projection !== "synced") { event.projection = "conflict"; await this.repo.put("care-events", op.babyId, event.id, event, req); }
        }
      }
      const receipt = await this.receipt(op, req, scope);
      op.receipt = receipt;
      // Persist one notice per operation. A pending first flush becomes the same
      // final notice after retry; final replay returns before this branch.
      if (op.noticeEligible === true && scope.actor.kind === "collector" && scope.groupId) {
        const previous = op.activityNotice;
        op.activityNotice = this.activityNotice(op, receipt, scope.groupId);
        if (previous) {
          op.activityNotice.id = previous.id;
          op.activityNotice.occurredAt = previous.occurredAt;
        }
      }
      await this.repo.put("care-operations", op.babyId, op.key, op, req);
      return { receipt, interruption };
    });
    // Commit each confirmed projection before returning a recoverable service stop.
    // Throwing inside the transaction would roll back its checkpoint after the remote write.
    if (outcome.interruption) throw outcome.interruption;
    return outcome.receipt;
  }
  private async receipt(op: Operation, req: PayloadRequest, scope:ActorScope): Promise<RecordReceipt> {
    const events = (await Promise.all(op.eventIds.map(id => this.repo.get<CareEvent>("care-events", op.babyId, id, req)))).filter((event): event is CareEvent => !!event);
    if(events.some(event=>!this.inScope(scope,event)))fail("EVENT_GROUP_FORBIDDEN","记录来源已变化，请由有权限的照护者核对。",403);
    const currentEvents = events.map(event => this.currentEvent(event));
    const questions = this.effectiveQuestions(null, currentEvents, (await this.repo.list<PendingQuestion>("care-questions", op.babyId, req)).filter(q => op.eventIds.includes(q.eventId)));
    return { requestId: op.requestId, status: op.status === "conflict" ? "conflict" : op.status === "pending" ? "pending_projection" : currentEvents.some(e => !e.complete || e.duplicateCandidates.length || e.conflicts.length) ? "needs_information" : "saved", events: currentEvents, questions, retryable: op.status === "pending" };
  }
  private activityNotice(op: Operation, receipt: RecordReceipt, groupId: string): RecordActivityNotice {
    const titles = receipt.events.map(event => {
      const facts = event.projection === "synced" && event.projected ? event.projected : event.facts;
      return facts.type ? recordActivityLabels[facts.type] || "照护记录" : event.intent === "feeding" ? "喂奶" : "照护记录";
    }).join("、");
    const subject = titles ? `：${titles}` : "";
    const text = receipt.status === "saved" ? `已整理微信群记录${subject}，已保存。`
      : receipt.status === "needs_information" ? `已整理微信群记录${subject}，已保留，${receipt.questions.length ? "还需补充" : "未知信息已保留"}。`
      : receipt.status === "conflict" ? `已整理微信群记录${subject}，发现冲突，未覆盖已有事实。`
      : `已整理微信群记录${subject}，仍在确认，尚未完成保存。`;
    return {
      id: `record-activity:${op.key}`, requestId: op.requestId, groupId, eventIds: receipt.events.map(event => event.id),
      occurredAt: new Date(this.identity.now()).toISOString(), outcome: receipt.status, text,
      events: receipt.events.map(event => {
        const facts = event.projection === "synced" && event.projected ? event.projected : event.facts;
        const title = facts.type ? recordActivityLabels[facts.type] || "照护记录" : event.intent === "feeding" ? "喂奶" : "照护记录";
        const parts = [title];
        if (event.facts.notes?.startsWith("[测试记录]")) parts.unshift("[测试记录]");
        if (event.facts.milkItems?.length) parts.push(...event.facts.milkItems.map(item => `${milkItemLabel(item)} ${item.milkAmountState === "known" ? `${item.milkAmount} 毫升` : item.milkAmountState === "unknown" ? "奶量未知" : "奶量待补"}`));
        else if (event.states.milkDescription === "known" && event.facts.milkDescription) parts.push(`奶品：${event.facts.milkDescription}`);
        if (event.states.milkAmount === "known" && typeof facts.milkAmount === "number") parts.push(facts.type === "PUMP" ? `泵出 ${facts.milkAmount} 毫升` : `实际喝入 ${facts.milkAmount} 毫升`);
        if (event.states.preparedMilkAmount === "known" && typeof facts.preparedMilkAmount === "number") parts.push(`泡好 ${facts.preparedMilkAmount} 毫升`);
        if (event.states.remainingMilkAmount === "known" && typeof facts.remainingMilkAmount === "number") parts.push(`剩余 ${facts.remainingMilkAmount} 毫升`);
        if (event.states.count === "known" && typeof facts.count === "number") parts.push(`${facts.count} 次`);
        if (event.progress === "ongoing") parts.push("仍在进行");
        return { id: event.id, version: event.version, title, startedAt: facts.startTime, summary: parts.join("，"), complete: event.complete };
      }),
    };
  }
  async record(principal: Principal, input: {babyId: string; requestId: string; events: EventInput[]}) {
    return this.mutate(principal, input.babyId, input.requestId, { tool: "record", ...input }, async (scope, req) => {
      const existing = await this.repo.list<CareEvent>("care-events", scope.babyId, req);
      const legacy = await this.legacy.listActivities(scope.babyId);
      const changes: Array<{before: CareEvent | null; after: CareEvent; unchanged?: boolean}> = [];
      for (const [index, entry] of input.events.entries()) {
        if (entry.facts.type === "BOTTLE" && (entry.states?.milkItems !== undefined || entry.states?.milkAmount !== undefined ||
          entry.states?.milkSource !== undefined || entry.states?.milkDescription !== undefined)) {
          fail("MILK_ITEM_STATE_TAMPER", "新瓶喂记录必须在 milkItems 各项中表达已知、待补或未知状态。", 400);
        }
        const sources = entry.sources || []; this.validateSources(scope, sources);
        if (scope.actor.kind === "collector" && !sources.length) fail("SOURCE_REQUIRED", "采集记录必须保留来源。", 400);
        const links = await Promise.all(sources.map(source => this.repo.get<{eventId:string}>("care-source-links", scope.babyId, sourceLinkKey(scope.babyId,source), req)));
        const linkedIds = [...new Set(links.flatMap(link => link ? [link.eventId] : []))];
        if (linkedIds.length > 1) fail("SOURCE_CONFLICT", "这些来源分别属于不同事件，请先核对。");
        if (linkedIds.length) {
          const old = await this.event(scope, linkedIds[0]!, req);
          changes.push({ before: old, after: old, unchanged: true }); continue;
        }
        const now = new Date(this.identity.now()).toISOString();
        const eventId = idFor(`${this.operationKey(scope, input.requestId)}:${index}`);
        const evaluated = evaluateEvent(this.anchorNewEvent(entry), { now: this.identity.now() });
        const after: CareEvent = { id: eventId, legacyId: eventId, babyId: scope.babyId, version: 1, ...evaluated,
          intent: entry.intent, lifecycle: "active", duplicateCandidates: [], sources, attachmentIds: entry.attachmentIds || [],
          actor: scope.actor, projection: "candidate", projected: null, createdAt: now, updatedAt: now };
        if (after.attachmentIds.length && !scope.permissions.includes("media:write")) fail("MEDIA_FORBIDDEN", "没有关联图片的权限。", 403);
        for (const id of after.attachmentIds) await this.validateAttachment(scope, req, id);
        const candidates = [...legacy.map(row => ({ id: row.id, facts: row })), ...existing.filter(e => e.lifecycle === "active").map(e => ({id: e.id, facts: e.facts})), ...changes.map(c => ({id:c.after.id,facts:c.after.facts}))];
        after.duplicateCandidates = [...new Set(candidates.filter(candidate => this.possibleDuplicate(after.facts, candidate.facts)).map(c => c.id))];
        if (!after.duplicateCandidates.length) after.conflicts.push(...candidates.flatMap(candidate => timeConflicts(after.facts, candidate.facts).map(issue=>({...issue,relatedEventId:candidate.id}))));
        if (after.conflicts.length) after.complete = false;
        changes.push({ before: null, after });
        // Reserve source links now so repeated entries in the same batch cannot create twice.
        for (const source of sources) await this.repo.put("care-source-links", scope.babyId, sourceLinkKey(scope.babyId,source), {eventId, source}, req);
        await this.repo.put("care-events", scope.babyId, eventId, after, req);
        await this.preferences.noteFirstEvent(scope.babyId, now, req);
      }
      return changes;
    });
  }
  private possibleDuplicate(a: Facts, b: Facts): boolean {
    if (!a.type || a.type !== b.type || !a.startTime || !b.startTime) return false;
    if (Math.abs(Date.parse(a.startTime) - Date.parse(b.startTime)) > 60000) return false;
    if (a.type === "BOTTLE") {
      if (a.milkItems?.length && b.milkItems?.length) {
        const composition = (facts: Facts) => JSON.stringify(facts.milkItems!.map(item => ({
          source: item.milkSource || item.milkDescription || item.milkSourceState,
          amount: item.milkAmountState === "known" ? item.milkAmount : item.milkAmountState,
        })));
        if (composition(a) !== composition(b)) return false;
      }
      const milkKind = (facts: Facts) => facts.milkDescription?.trim() ||
        (facts.milkSource === "FORMULA" ? "奶粉" : facts.milkSource === "BREAST_MILK" ? "母乳" : undefined);
      const aKind = milkKind(a); const bKind = milkKind(b);
      if (aKind && bKind && aKind !== bKind) return false;
    }
    return a.milkAmount == null || b.milkAmount == null || a.milkAmount === b.milkAmount;
  }
  async update(principal: Principal, input: {babyId:string;requestId:string;eventId:string;expectedVersion:number;patch:RulePatch;sources?:SourceRef[]}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"update",...input},async(scope,req)=>{
      const before=await this.event(scope,input.eventId,req); this.checkVersion(before,input.expectedVersion);
      this.validateMilkItemUpdate(before, input.patch);
      const after=this.apply(structuredClone(before),input.patch);
      await this.recheck(scope,before,after,req);
      this.validateSources(scope,input.sources||[]);
      after.sources=this.mergeSources(after.sources,input.sources||[]);
      return [{before,after}];
    });
  }
  private mergeSources(a:SourceRef[],b:SourceRef[]) { return [...new Map([...a,...b].map(source=>[sourceKey(source),source])).values()]; }
  async answer(principal: Principal,input:{babyId:string;requestId:string;questionId:string;questionVersion:number;eventVersion:number;patch:RulePatch;sources?:SourceRef[]}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"answer",...input},async(scope,req)=>{
      const question=await this.repo.get<PendingQuestion>("care-questions",scope.babyId,input.questionId,req);
      if(!question||question.state!=="open"||question.version!==input.questionVersion||question.eventVersion!==input.eventVersion) fail("QUESTION_STALE","问题已更新或解决，请重新读取待补充事项。");
      const before=await this.event(scope,question.eventId,req);this.checkVersion(before,input.eventVersion);
      const effective=this.effectiveQuestion(question,before);
      if(!effective) fail("QUESTION_STALE","当前规则已不再需要这个问题，请重新读取待补充事项。");
      this.validateSources(scope,input.sources||[]);
      const allowed = new Set<Field>(effective.fields);
      if (allowed.has("endTime") || allowed.has("durationMinutes")) { allowed.add("endTime"); allowed.add("durationMinutes"); }
      if (allowed.has("milkSource") && before.facts.type === "BOTTLE" && before.states.milkSource !== "known") allowed.add("milkDescription");
      this.validatePendingPatch(before, allowed, input.patch);
      for (const field of [...Object.keys(input.patch.facts), ...Object.keys(input.patch.states || {})] as Field[]) if (!allowed.has(field)) fail("BATCH_FIELD_MISMATCH", "答案包含当前问题未要求的字段。", 400);
      if (input.patch.progress && !allowed.has("endTime") && !allowed.has("durationMinutes")) fail("BATCH_FIELD_MISMATCH", "当前问题不能提交进行状态。", 400);
      const after=this.apply(structuredClone(before),input.patch);after.sources=this.mergeSources(after.sources,input.sources||[]);
      await this.recheck(scope,before,after,req);
      return [{before,after}];
    });
  }
  async answerBatch(principal: Principal, input: PendingBatchInput) {
    return this.mutate(principal, input.babyId, input.requestId, { tool: "pending_batch", ...input }, async (scope, req) => {
      const changes: Array<{ before: CareEvent | null; after: CareEvent }> = [];
      const primaryIds = new Set(input.items.map(item => item.eventId));
      const touched = new Set<string>();
      for (const item of input.items) {
        const question = await this.repo.get<PendingQuestion>("care-questions", scope.babyId, item.questionId, req);
        if (!question || question.state !== "open" || question.eventId !== item.eventId || question.version !== item.questionVersion || question.eventVersion !== item.eventVersion) {
          fail("QUESTION_STALE", "问题已更新、解决或与目标记录不一致，请重新读取待补充事项。");
        }
        const before = await this.event(scope, item.eventId, req);
        this.checkVersion(before, item.eventVersion);
        const effective = this.effectiveQuestion(question, before);
        if (!effective) fail("QUESTION_STALE", "当前规则已不再需要这个问题，请重新读取待补充事项。");
        if (touched.has(before.id)) fail("DUPLICATE_BATCH_TARGET", "同一批次不能重复修改同一记录。", 400);
        touched.add(before.id);

        if (item.kind === "answer") {
          if (!effective.fields.length) fail("BATCH_OPERATION_UNSUPPORTED", "重复或冲突问题不能用字段答案处理。", 400);
          const allowed = new Set<Field>(effective.fields);
          if (allowed.has("endTime") || allowed.has("durationMinutes")) { allowed.add("endTime"); allowed.add("durationMinutes"); }
          const milkDescriptionAlias = allowed.has("milkSource") && before.facts.type === "BOTTLE" && before.states.milkSource !== "known";
          if (milkDescriptionAlias) allowed.add("milkDescription");
          this.validatePendingPatch(before, allowed, item.patch);
          if (item.patch.facts.milkDescription !== undefined && item.patch.facts.milkSource !== undefined) fail("BATCH_FIELD_MISMATCH", "奶品原话不能同时被猜测为奶粉或母乳。", 400);
          for (const field of [...Object.keys(item.patch.facts), ...Object.keys(item.patch.states || {})] as Field[]) {
            if (!allowed.has(field)) fail("BATCH_FIELD_MISMATCH", "批量答案包含当前问题未要求的字段。", 400);
          }
          if (item.patch.progress && !allowed.has("endTime") && !allowed.has("durationMinutes")) fail("BATCH_FIELD_MISMATCH", "当前问题不能提交进行状态。", 400);
          if (!Object.keys(item.patch.facts).length && !Object.keys(item.patch.states || {}).length && !item.patch.progress && !item.patch.milkItemAnswers?.length) fail("BATCH_ANSWER_EMPTY", "批量答案不能为空。", 400);
          this.validateSources(scope, item.sources || []);
          const after = this.apply(structuredClone(before), item.patch);
          after.sources = this.mergeSources(after.sources, item.sources || []);
          changes.push({ before, after });
          continue;
        }

        if (scope.actor.kind === "collector") fail("CAREGIVER_REQUIRED", "重复或重叠核对需要照护者确认。", 403);
        if (item.kind === "resolve_duplicate") {
          if (!effective.duplicateCandidates.length) fail("NO_DUPLICATE", "记录没有待核对的重复项。");
          const after = structuredClone(before); after.duplicateCandidates = [];
          if (item.resolution === "distinct") {
            after.distinctFrom = [...new Set([...(before.distinctFrom || []), ...before.duplicateCandidates])];
            changes.push({ before, after });
            continue;
          }
          if (!item.targetEventId || !item.targetVersion || !before.duplicateCandidates.includes(item.targetEventId)) fail("DUPLICATE_TARGET_REQUIRED", "请选择当前候选中的原记录并提供版本。", 400);
          if (primaryIds.has(item.targetEventId) || touched.has(item.targetEventId)) fail("BATCH_TARGET_COLLISION", "合并目标不能同时作为本批次的另一项修改目标。", 400);
          const target = await this.event(scope, item.targetEventId, req); this.checkVersion(target, item.targetVersion);
          if (after.attachmentIds.some(id => !target.attachmentIds.includes(id)) && !scope.permissions.includes("media:write")) fail("MEDIA_FORBIDDEN", "没有关联图片的权限。", 403);
          touched.add(target.id); after.lifecycle = "merged"; after.mergedInto = target.id;
          const merged = { ...structuredClone(target), sources: this.mergeSources(target.sources, after.sources), attachmentIds: [...new Set([...target.attachmentIds, ...after.attachmentIds])] };
          changes.push({ before, after }, { before: target, after: merged });
          continue;
        }

        const allowedConflicts = new Set(effective.conflicts.filter(issue => issue.code === "TIME_OVERLAP" && issue.relatedEventId).map(issue => issue.relatedEventId!));
        if (item.conflictingEvents.some(target => !allowedConflicts.has(target.eventId))) fail("INVALID_OVERLAP", "只能确认当前问题列出的真实重叠记录。", 400);
        const after = this.apply(structuredClone(before), { facts: {} }); after.confirmedOverlaps = { ...before.confirmedOverlaps };
        for (const targetPin of item.conflictingEvents) {
          const id = targetPin.eventId;
          if (id === before.id) fail("INVALID_OVERLAP", "不能确认与自身重叠。", 400);
          if (primaryIds.has(id)) fail("BATCH_TARGET_COLLISION", "本批次同时修改了重叠记录，旧的重叠确认已经失效；请保存时间修改后重新核对。", 409);
          const other = await this.event(scope, id, req);
          this.checkVersion(other, targetPin.expectedVersion);
          const current = await this.legacy.getActivity(scope.babyId, other.legacyId);
          const facts = current || other.facts;
          if (other.lifecycle !== "active" || !timeConflicts(after.facts, facts).length) fail("OVERLAP_CHANGED", "重叠记录已经变化，请重新核对。");
          after.confirmedOverlaps[id] = overlapKey(after.facts, facts);
        }
        after.evidence.push({ field: "startTime", kind: "reported", confirmed: true, detail: `Confirmed actual overlap: ${item.reason}` });
        changes.push({ before, after });
      }
      const overlay = new Map(changes.map(change => [change.after.id, change.after]));
      for (const change of changes) if (change.after.lifecycle === "active" && change.before) await this.recheck(scope, change.before, change.after, req, overlay);
      return changes;
    });
  }
  async retract(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number},restore=false) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:restore?"restore":"retract",...input},async(scope,req)=>{
      if(restore&&scope.actor.kind==="collector")fail("CAREGIVER_REQUIRED","恢复已撤销记录需要照护者确认。",403);
      const before=await this.event(scope,input.eventId,req);this.checkVersion(before,input.expectedVersion,restore);
      if(restore&&before.lifecycle!=="retracted")fail("CANNOT_RESTORE","只有明确撤销的记录可以恢复。");
      const after=restore?this.apply(structuredClone(before),{facts:{}}):structuredClone(before);after.lifecycle=restore?"active":"retracted";
      if(restore)await this.recheck(scope,before,after,req);
      return [{before,after}];
    });
  }
  async undo(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number;revisionId:string}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"undo",...input},async(scope,req)=>{
      if(scope.actor.kind==="collector")fail("CAREGIVER_REQUIRED","撤销修订并恢复旧事实需要照护者确认。",403);
      const before=await this.event(scope,input.eventId,req);this.checkVersion(before,input.expectedVersion,true);
      const revision=await this.repo.get<Revision>("care-revisions",scope.babyId,input.revisionId,req);
      if(!revision||revision.eventId!==before.id||revision.version!==before.version)fail("REVISION_STALE","只能撤销当前最新修订，请先核对记录。");
      const after=revision.before?this.apply({...structuredClone(revision.before),projected:before.projected},{facts:{}}): {...structuredClone(before),lifecycle:"retracted" as const};
      after.sources=this.mergeSources(before.sources,after.sources);
      if(after.lifecycle==="active")await this.recheck(scope,before,after,req);
      return [{before,after}];
    });
  }
  async attach(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number;attachmentIds:string[]}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"attach",...input},async(scope,req)=>{
      const before=await this.event(scope,input.eventId,req);this.checkVersion(before,input.expectedVersion);
      if(!scope.permissions.includes("media:write")) fail("MEDIA_FORBIDDEN","没有关联图片的权限。",403);
      for(const id of input.attachmentIds)await this.validateAttachment(scope,req,id);
      return [{before,after:{...structuredClone(before),attachmentIds:[...new Set(input.attachmentIds)]}}];
    });
  }
  async resolveDuplicate(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number;resolution:"distinct"|"same";targetEventId?:string;targetVersion?:number}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"duplicate",...input},async(scope,req)=>{
      if(scope.actor.kind==="collector")fail("CAREGIVER_REQUIRED","疑似重复需要照护者核对确认。",403);
      const before=await this.event(scope,input.eventId,req);this.checkVersion(before,input.expectedVersion);
      if(!before.duplicateCandidates.length)fail("NO_DUPLICATE","记录没有待核对的重复项。");
      const after=structuredClone(before);after.duplicateCandidates=[];
      if(input.resolution==="distinct"){after.distinctFrom=[...new Set([...(before.distinctFrom||[]),...before.duplicateCandidates])];return [{before,after}];}
      if(!input.targetEventId||!before.duplicateCandidates.includes(input.targetEventId)||!input.targetVersion)fail("DUPLICATE_TARGET_REQUIRED","请选择当前候选中的原记录并提供版本。",400);
      const target=await this.event(scope,input.targetEventId,req);this.checkVersion(target,input.targetVersion);
      if(after.attachmentIds.some(id=>!target.attachmentIds.includes(id))&&!scope.permissions.includes("media:write"))fail("MEDIA_FORBIDDEN","没有关联图片的权限。",403);
      after.lifecycle="merged";after.mergedInto=target.id;
      const merged={...structuredClone(target),sources:this.mergeSources(target.sources,after.sources),attachmentIds:[...new Set([...target.attachmentIds,...after.attachmentIds])]};
      // Source links remain pointing at the merged tombstone, so replay cannot recreate it.
      return [{before,after},{before:target,after:merged}];
    });
  }
  async confirmOverlap(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number;conflictingEventIds:string[];reason:string}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"confirm_overlap",...input},async(scope,req)=>{
      if(scope.actor.kind==="collector")fail("CAREGIVER_REQUIRED","真实时间重叠需要照护者核对确认。",403);
      const before=await this.event(scope,input.eventId,req);this.checkVersion(before,input.expectedVersion);
      const after=this.apply(structuredClone(before),{facts:{}});after.confirmedOverlaps={...before.confirmedOverlaps};
      for(const id of new Set(input.conflictingEventIds)) {
        if(id===before.id)fail("INVALID_OVERLAP","不能确认与自身重叠。",400);
        const other=await this.event(scope,id,req);
        const current=await this.legacy.getActivity(scope.babyId,other.legacyId);
        const facts=current||other.facts;
        if(other.lifecycle!=="active"||!timeConflicts(after.facts,facts).length)fail("OVERLAP_CHANGED","重叠记录已经变化，请重新核对。");
        after.confirmedOverlaps[id]=overlapKey(after.facts,facts);
      }
      after.evidence.push({field:"startTime",kind:"reported",confirmed:true,detail:`Confirmed actual overlap: ${input.reason}`});
      await this.recheck(scope,before,after,req);
      return [{before,after}];
    });
  }
  async getRequest(principal:Principal,input:{babyId:string;requestId:string;retry?:boolean}) {
    const op=await this.authorized(principal,input.babyId,!!input.retry,async(scope,req)=>this.repo.get<Operation>("care-operations",scope.babyId,this.operationKey(scope,input.requestId),req));
    if(!op)fail("REQUEST_NOT_FOUND","请求尚未保存。",404);
    if(input.retry&&op.status==="pending")return this.serial(()=>this.flush(principal,op));
    return this.authorized(principal,input.babyId,false,(scope,req)=>this.receipt(op,req,scope));
  }
  async query(principal:Principal,input:{babyId:string;date?:string;eventId?:string;includeRetracted?:boolean}) {
    return this.authorized(principal,input.babyId,false,async(scope,req)=>{
      const legacy=await this.legacy.listActivities(scope.babyId);
      const stored=await this.repo.list<CareEvent>("care-events",scope.babyId,req);
      const currentById=new Map(legacy.map(row=>[row.id,row]));
      const ids=new Set(stored.map(e=>e.legacyId));
      const events=[...stored.filter(event=>this.inScope(scope,event)),...legacy.filter(row=>scope.actor.kind!=="collector"&&!ids.has(row.id)).map(row=>this.fromLegacy(scope,row))];
      const inDate=(facts:Facts,ongoing=false)=>!input.date||activityInDate(facts,input.date,ongoing,this.identity.now());
      const currentEvents=events.map(event=>this.currentEvent(event));
      const filtered=currentEvents.filter(event=>{
        const current=currentById.get(event.legacyId);
        const observed=event.projection==="synced"&&current?current:event.facts;
        const ongoing=event.projection==="synced"?!!current&&isActivityOngoing(current,event):event.progress==="ongoing"&&!event.facts.endTime;
        return (input.includeRetracted||event.lifecycle==="active")&&(!input.eventId||event.id===input.eventId)&&(!observed.startTime||inDate(observed,ongoing));
      }).map(event=>({...event,currentActivity:currentById.get(event.legacyId)||null}));
      const activities=this.enrichCanonicalActivities(legacy.filter(row=>{
        const event=stored.find(e=>e.legacyId===row.id);
        if(scope.actor.kind==="collector"&&(!event||!this.inScope(scope,event)))return false;
        return !event||event.projection!=="synced"||(event.lifecycle==="active"&&!event.duplicateCandidates.length);
      }),stored);
      const questions=this.effectiveQuestions(scope,currentEvents,await this.repo.list<PendingQuestion>("care-questions",scope.babyId,req),input.eventId);
      const selectedActivities=activities.filter(row=>(!input.eventId||row.id===input.eventId)&&inDate(row,isActivityOngoing(row,stored.find(event=>event.legacyId===row.id))));
      return {events:filtered,activities:selectedActivities,questions,...(input.date?{summary:computeStatistics(activities,input.date,currentEvents,this.identity.now())}:{})};
    });
  }
  async pending(principal:Principal,babyId:string) { return this.authorized(principal,babyId,false,async(scope,req)=>{const events=await this.repo.list<CareEvent>("care-events",babyId,req);return this.effectiveQuestions(scope,events,await this.repo.list<PendingQuestion>("care-questions",scope.babyId,req));}); }
  async activity(principal:Principal,babyId:string,limit=50) {
    return this.authorized(principal,babyId,false,async(scope,req)=>{
      const operations=await this.repo.list<Operation>("care-operations",scope.babyId,req);
      const messages=operations.map(op=>op.activityNotice).filter((notice): notice is RecordActivityNotice => !!notice)
        .filter(notice=>scope.actor.kind!=="collector"||notice.groupId===scope.groupId)
        .sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.id.localeCompare(a.id))
        .slice(0,Math.min(Math.max(Math.trunc(limit)||50,1),200));
      return { messages };
    });
  }
  async revisions(principal:Principal,babyId:string,eventId:string) { return this.authorized(principal,babyId,false,async(scope,req)=>{await this.event(scope,eventId,req);return(await this.repo.list<Revision>("care-revisions",babyId,req)).filter(r=>r.eventId===eventId);}); }
  async summary(principal:Principal,babyId:string,date:string) { return (await this.query(principal,{babyId,date})).summary; }
  async reconcile(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"accept_legacy",...input},async(scope,req)=>{
      const before=await this.event(scope,input.eventId,req);
      if(before.version!==input.expectedVersion)fail("VERSION_CONFLICT","请先读取当前版本。");
      if(before.projection==="pending")fail("PROJECTION_PENDING","上次保存仍待恢复，请先查询并恢复原请求。");
      this.assertBottleEvaluationSupported(before);
      const current=await this.legacy.getActivity(scope.babyId,before.legacyId);
      const after=structuredClone(before);
      after.projected=current;after.conflicts=[];
      if(!current)after.lifecycle="retracted";
      else {
        if (after.facts.type === "BOTTLE" && after.facts.milkItems?.length) {
          const totalChanged = hash(current.milkAmount) !== hash(before.projected?.milkAmount);
          const sourceChanged = hash(current.milkSource) !== hash(before.projected?.milkSource);
          if ((totalChanged || sourceChanged) && after.facts.milkItems.length !== 1) {
            fail("BOTTLE_ITEMS_RECONCILE_AMBIGUOUS", "旧记录的整餐奶量或奶源已被修改，无法无损分配到多项奶品明细；请先人工核对各明细。", 409);
          }
          const item = after.facts.milkItems[0];
          if (item && totalChanged) {
            if (typeof current.milkAmount === "number") { item.milkAmount = current.milkAmount; item.milkAmountState = "known"; }
            else { delete item.milkAmount; item.milkAmountState = "unknown"; }
          }
          if (item && sourceChanged) {
            if (current.milkSource) { item.milkSource = current.milkSource; delete item.milkDescription; item.milkSourceState = "known"; }
            else { delete item.milkSource; delete item.milkDescription; item.milkSourceState = "unknown"; }
          }
        }
        const metadata=["preparedMilkAmount","remainingMilkAmount","sameBottle","reportedIntake","milkDescription","milkItems"];
        const facts=Object.fromEntries(Object.entries(after.facts).filter(([field])=>metadata.includes(field)));
        const states=Object.fromEntries(Object.entries(after.states).filter(([field])=>metadata.includes(field)));
        const evidence=after.evidence.filter(item=>metadata.includes(item.field));
        Object.assign(after,this.apply({...after,facts,states,evidence},{facts:legacyFacts(current)}));
        if(after.facts.type!=="BREASTFEED")after.evidence=after.evidence.filter(item=>item.field!=="reportedIntake");
      }
      // Set expected to the explicitly accepted latest snapshot, never silently overwrite it.
      return [{before:{...before,projected:current},after}];
    });
  }
  today() { return chinaDate(this.identity.now()); }
  async collectorOperation(babyId:string,requestId:string,req:PayloadRequest,principal:Principal,actor?:CollectorOperationActor):Promise<CollectorOperationSnapshot> {
    const exact=actor ?? (principal.kind==="collector"&&principal.babyId===babyId ? {kind:"collector" as const,babyId,groupId:principal.groupId||"",subjectId:principal.subjectId} : undefined);
    if(!exact || exact.kind!=="collector" || exact.babyId!==babyId || !exact.groupId || !exact.subjectId) return {status:"missing"};
    const key=hash([exact.babyId,exact.kind,exact.subjectId,"",exact.groupId,requestId]);
    const op=await this.repo.get<Operation>("care-operations",babyId,key,req);
    if(!op||op.actor.kind!=="collector"||op.actor.id!==exact.subjectId)return {status:"missing"};
    return {status:op.status};
  }
  async verifyCollectorReceipt(babyId:string,requestId:string,req:PayloadRequest,principal:Principal,actor?:CollectorOperationActor):Promise<CollectorOperationSnapshot> {
    return this.collectorOperation(babyId,requestId,req,principal,actor);
  }
}
