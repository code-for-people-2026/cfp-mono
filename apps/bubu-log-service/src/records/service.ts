import { AppError } from "../contracts";
import type { ActorScope, Principal, IdentityService } from "../identity";
import type { PayloadRequest } from "payload";
import { RecordsRepository, hash } from "./persistence";
import { evaluateEvent, timeConflicts } from "./rules";
import { affectedDates, computeStatistics, chinaDate, activityInDate, isActivityOngoing } from "./statistics";
import type { CareEvent, EventInput, Facts, Field, RuleInput, LegacyActivity, LegacyRecordsBackend, PendingQuestion, RecordReceipt, SourceRef } from "./types";

type AttachmentValidator = (scope: ActorScope, req: PayloadRequest, id: string) => Promise<unknown>;
interface Projection { eventId: string; version: number; expected: LegacyActivity | null; desired: LegacyActivity | null }
interface Revision { id: string; eventId: string; babyId: string; version: number; before: CareEvent | null; after: CareEvent; actor: ActorScope["actor"]; at: string }
interface Operation {
  key: string; requestId: string; babyId: string; fingerprint: string; actor: ActorScope["actor"];
  eventIds: string[]; projections: Projection[]; dates: string[];
  status: "pending" | "done" | "conflict"; error?: string; receipt?: RecordReceipt;
}
function fail(code: string, message: string, status = 409): never { throw new AppError(status, code, message); }
export const sourceKey = (source: SourceRef) => hash([source.kind, source.accountId, source.conversationId, source.messageId, source.eventKey]);
const sourceLinkKey = (babyId:string,source:SourceRef) => hash([babyId,sourceKey(source)]);
const pointTypes = new Set(["DIAPER", "SUPPLEMENT", "SPIT_UP", "ROLL_OVER", "PULL_TO_SIT"]);
const idFor = (value: string) => `bubu-${hash(value).slice(0, 40)}`;
const legacyFacts = (activity: LegacyActivity): Facts => Object.fromEntries(Object.entries(activity).filter(([field]) => !["id", "babyId", "createdAt", "updatedAt"].includes(field)));
const overlapKey = (left:Facts,right:Facts) => hash([left.type,left.startTime,left.endTime,right.type,right.startTime,right.endTime]);

/** The sidecar owns intent/revisions; the existing Activity remains the projected fact.
 * A committed operation is deliberately separate from the remote mutation transaction. */
export class RecordsService {
  readonly repo: RecordsRepository;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly identity: IdentityService, readonly legacy: LegacyRecordsBackend,
    private readonly validateAttachment: AttachmentValidator = async () => { throw new AppError(503, "ATTACHMENTS_UNAVAILABLE", "附件服务未配置。"); }) {
    this.repo = new RecordsRepository(identity.store.payload);
  }
  private async authorized<T>(principal: Principal, babyId: string, write: boolean, action: (scope: ActorScope, req: PayloadRequest) => Promise<T>) {
    return this.identity.executeAuthorized(principal, babyId, write ? "records:write" : "records:read", action, principal.kind === "collector" ? principal.groupId : undefined);
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
  private async recheck(scope: ActorScope, before: CareEvent, after: CareEvent, req: PayloadRequest) {
    const identityChanged = ["type", "startTime", "milkAmount"].some(field => before.facts[field as Field] !== after.facts[field as Field]);
    if (identityChanged) after.distinctFrom = [];
    const legacy = await this.legacy.listActivities(scope.babyId);
    const saved = await this.repo.list<CareEvent>("care-events", scope.babyId, req);
    const candidates = [...new Map([...saved.filter(e => e.lifecycle === "active").map(e => ({id:e.id,facts:e.facts})),...legacy.map(row => ({id:row.id,facts:row}))].map(candidate=>[candidate.id,candidate])).values()]
      .filter(candidate => candidate.id !== after.id && candidate.id !== after.legacyId);
    after.duplicateCandidates = [...new Set(candidates.filter(candidate => !after.distinctFrom?.includes(candidate.id) && this.possibleDuplicate(after.facts,candidate.facts)).map(candidate=>candidate.id))];
    if (!after.duplicateCandidates.length) after.conflicts.push(...candidates.filter(candidate=>!after.distinctFrom?.includes(candidate.id)&&after.confirmedOverlaps?.[candidate.id]!==overlapKey(after.facts,candidate.facts)).flatMap(candidate=>timeConflicts(after.facts,candidate.facts).map(issue=>({...issue,relatedEventId:candidate.id}))));
    if (after.conflicts.length) after.complete=false;
  }
  private apply(event: CareEvent, patch: RuleInput): CareEvent {
    const facts = { ...event.facts, ...patch.facts };
    const changed = new Set(Object.keys(patch.facts));
    if ((changed.has("startTime") || changed.has("endTime")) && !changed.has("durationMinutes")) delete facts.durationMinutes;
    if (changed.has("durationMinutes") && !changed.has("endTime")) delete facts.endTime;
    const states = { ...event.states, ...patch.states };
    if (!facts.durationMinutes && !changed.has("durationMinutes")) delete states.durationMinutes;
    if (changed.has("durationMinutes") && !changed.has("endTime")) delete states.endTime;
    for (const key of Object.keys(patch.facts) as Field[]) if (!patch.states?.[key]) states[key] = patch.facts[key] == null ? "pending" : "known";
    const evaluation = evaluateEvent({ facts, states, progress: patch.progress ?? (changed.has("endTime") || changed.has("durationMinutes") ? "ended" : event.progress),
      intent: patch.intent ?? event.intent, evidence: patch.evidence ?? event.evidence.filter(item => !changed.has(item.field)) }, { now: this.identity.now() });
    return { ...event, ...evaluation, ...(patch.intent ? { intent: patch.intent } : {}) };
  }
  private desired(event: CareEvent): LegacyActivity | null {
    if (event.lifecycle !== "active" || event.duplicateCandidates.length || !event.facts.type || !event.facts.startTime || event.conflicts.length) return null;
    const facts = { ...event.facts };
    delete facts.preparedMilkAmount; delete facts.remainingMilkAmount; delete facts.sameBottle; delete facts.durationMinutes;
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
        const projections: Projection[] = [];
        for (const change of changes) {
          if (change.unchanged) continue;
          const action = await this.persist(scope, change.before, change.after, req);
          if (action) projections.push(action);
        }
        const next: Operation = { key, requestId, babyId, fingerprint, actor: scope.actor,
          eventIds: [...new Set(changes.map(change => change.after.id))], projections,
          dates: affectedDates(changes.flatMap(change => [change.before?.projected || {}, change.after.facts])), status: "pending" };
        await this.repo.put("care-operations", babyId, key, next, req);
        return next;
      });
      if (operation.receipt && operation.status !== "pending") return operation.receipt;
      return this.flush(principal, operation);
    });
  }
  private async flush(principal: Principal, operation: Operation): Promise<RecordReceipt> {
    return this.authorized(principal, operation.babyId, true, async (scope, req) => {
      const op = (await this.repo.get<Operation>("care-operations", operation.babyId, operation.key, req))!;
      try {
        for (const action of op.projections) {
          const event = (await this.repo.get<CareEvent>("care-events", op.babyId, action.eventId, req))!;
          // Only a projected revision can be edited. A newer revision means this
          // older action already succeeded; never replay it over later intent.
          if(event.version!==action.version)continue;
          if (event.projection === "synced") continue;
          const projected = await this.legacy.writeActivity(op.babyId, event.legacyId, action.desired, action.expected);
          event.projected = projected; event.projection = "synced";
          await this.repo.put("care-events", op.babyId, event.id, event, req);
        }
        if (op.projections.length) {
          const activities = await this.legacy.listActivities(op.babyId);
          const events = await this.repo.list<CareEvent>("care-events", op.babyId, req);
          for (const date of op.dates) await this.legacy.saveDailyStats(op.babyId, date, computeStatistics(activities, date, events, this.identity.now()).metrics);
        }
        op.status = "done"; delete op.error;
      } catch (error) {
        op.status = error instanceof AppError && error.status === 409 ? "conflict" : "pending";
        op.error = error instanceof AppError ? error.code : "PROJECTION_UNAVAILABLE";
        if (op.status === "conflict") for (const action of op.projections) {
          const event = (await this.repo.get<CareEvent>("care-events", op.babyId, action.eventId, req))!;
          if (event.version===action.version&&event.projection !== "synced") { event.projection = "conflict"; await this.repo.put("care-events", op.babyId, event.id, event, req); }
        }
      }
      const receipt = await this.receipt(op, req, scope);
      op.receipt = receipt;
      await this.repo.put("care-operations", op.babyId, op.key, op, req);
      return receipt;
    });
  }
  private async receipt(op: Operation, req: PayloadRequest, scope:ActorScope): Promise<RecordReceipt> {
    const events = (await Promise.all(op.eventIds.map(id => this.repo.get<CareEvent>("care-events", op.babyId, id, req)))).filter((event): event is CareEvent => !!event);
    if(events.some(event=>!this.inScope(scope,event)))fail("EVENT_GROUP_FORBIDDEN","记录来源已变化，请由有权限的照护者核对。",403);
    const questions = (await this.repo.list<PendingQuestion>("care-questions", op.babyId, req)).filter(q => op.eventIds.includes(q.eventId) && q.state === "open");
    return { requestId: op.requestId, status: op.status === "conflict" ? "conflict" : op.status === "pending" ? "pending_projection" : events.some(e => !e.complete || e.duplicateCandidates.length || e.conflicts.length) ? "needs_information" : "saved", events, questions, retryable: op.status === "pending" };
  }
  async record(principal: Principal, input: {babyId: string; requestId: string; events: EventInput[]}) {
    return this.mutate(principal, input.babyId, input.requestId, { tool: "record", ...input }, async (scope, req) => {
      const existing = await this.repo.list<CareEvent>("care-events", scope.babyId, req);
      const legacy = await this.legacy.listActivities(scope.babyId);
      const changes: Array<{before: CareEvent | null; after: CareEvent; unchanged?: boolean}> = [];
      for (const [index, entry] of input.events.entries()) {
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
        const evaluated = evaluateEvent(entry, { now: this.identity.now() });
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
      }
      return changes;
    });
  }
  private possibleDuplicate(a: Facts, b: Facts): boolean {
    if (!a.type || a.type !== b.type || !a.startTime || !b.startTime) return false;
    if (Math.abs(Date.parse(a.startTime) - Date.parse(b.startTime)) > 60000) return false;
    return a.milkAmount == null || b.milkAmount == null || a.milkAmount === b.milkAmount;
  }
  async update(principal: Principal, input: {babyId:string;requestId:string;eventId:string;expectedVersion:number;patch:RuleInput;sources?:SourceRef[]}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"update",...input},async(scope,req)=>{
      const before=await this.event(scope,input.eventId,req); this.checkVersion(before,input.expectedVersion);
      const after=this.apply(structuredClone(before),input.patch);
      await this.recheck(scope,before,after,req);
      this.validateSources(scope,input.sources||[]);
      after.sources=this.mergeSources(after.sources,input.sources||[]);
      return [{before,after}];
    });
  }
  private mergeSources(a:SourceRef[],b:SourceRef[]) { return [...new Map([...a,...b].map(source=>[sourceKey(source),source])).values()]; }
  async answer(principal: Principal,input:{babyId:string;requestId:string;questionId:string;questionVersion:number;eventVersion:number;patch:RuleInput;sources?:SourceRef[]}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"answer",...input},async(scope,req)=>{
      const question=await this.repo.get<PendingQuestion>("care-questions",scope.babyId,input.questionId,req);
      if(!question||question.state!=="open"||question.version!==input.questionVersion||question.eventVersion!==input.eventVersion) fail("QUESTION_STALE","问题已更新或解决，请重新读取待补充事项。");
      const before=await this.event(scope,question.eventId,req);this.checkVersion(before,input.eventVersion);
      this.validateSources(scope,input.sources||[]);
      const after=this.apply(structuredClone(before),input.patch);after.sources=this.mergeSources(after.sources,input.sources||[]);
      await this.recheck(scope,before,after,req);
      return [{before,after}];
    });
  }
  async retract(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number},restore=false) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:restore?"restore":"retract",...input},async(scope,req)=>{
      const before=await this.event(scope,input.eventId,req);this.checkVersion(before,input.expectedVersion,restore);
      if(restore&&before.lifecycle!=="retracted")fail("CANNOT_RESTORE","只有明确撤销的记录可以恢复。");
      const after=restore?this.apply(structuredClone(before),{facts:{}}):structuredClone(before);after.lifecycle=restore?"active":"retracted";
      if(restore)await this.recheck(scope,before,after,req);
      return [{before,after}];
    });
  }
  async undo(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number;revisionId:string}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"undo",...input},async(scope,req)=>{
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
      const filtered=events.filter(event=>{
        const current=currentById.get(event.legacyId);
        const observed=event.projection==="synced"&&current?current:event.facts;
        const ongoing=event.projection==="synced"?!!current&&isActivityOngoing(current,event):event.progress==="ongoing"&&!event.facts.endTime;
        return (input.includeRetracted||event.lifecycle==="active")&&(!input.eventId||event.id===input.eventId)&&(!observed.startTime||inDate(observed,ongoing));
      }).map(event=>({...event,currentActivity:currentById.get(event.legacyId)||null}));
      const activities=legacy.filter(row=>{
        const event=stored.find(e=>e.legacyId===row.id);
        if(scope.actor.kind==="collector"&&(!event||!this.inScope(scope,event)))return false;
        return !event||event.projection!=="synced"||(event.lifecycle==="active"&&!event.duplicateCandidates.length);
      });
      const questions=(await this.repo.list<PendingQuestion>("care-questions",scope.babyId,req)).filter(q=>q.state==="open"&&events.some(event=>event.id===q.eventId)&&(!input.eventId||q.eventId===input.eventId));
      const selectedActivities=activities.filter(row=>(!input.eventId||row.id===input.eventId)&&inDate(row,isActivityOngoing(row,stored.find(event=>event.legacyId===row.id))));
      return {events:filtered,activities:selectedActivities,questions,...(input.date?{summary:computeStatistics(activities,input.date,events,this.identity.now())}:{})};
    });
  }
  async pending(principal:Principal,babyId:string) { return this.authorized(principal,babyId,false,async(scope,req)=>{const events=await this.repo.list<CareEvent>("care-events",babyId,req);return(await this.repo.list<PendingQuestion>("care-questions",scope.babyId,req)).filter(q=>q.state==="open"&&events.some(event=>event.id===q.eventId&&this.inScope(scope,event)));}); }
  async revisions(principal:Principal,babyId:string,eventId:string) { return this.authorized(principal,babyId,false,async(scope,req)=>{await this.event(scope,eventId,req);return(await this.repo.list<Revision>("care-revisions",babyId,req)).filter(r=>r.eventId===eventId);}); }
  async summary(principal:Principal,babyId:string,date:string) { return (await this.query(principal,{babyId,date})).summary; }
  async reconcile(principal:Principal,input:{babyId:string;requestId:string;eventId:string;expectedVersion:number}) {
    return this.mutate(principal,input.babyId,input.requestId,{tool:"accept_legacy",...input},async(scope,req)=>{
      const before=await this.event(scope,input.eventId,req);
      if(before.version!==input.expectedVersion)fail("VERSION_CONFLICT","请先读取当前版本。");
      if(before.projection==="pending")fail("PROJECTION_PENDING","上次保存仍待恢复，请先查询并恢复原请求。");
      const current=await this.legacy.getActivity(scope.babyId,before.legacyId);
      const after=structuredClone(before);
      after.projected=current;after.conflicts=[];
      if(!current)after.lifecycle="retracted";
      else {
        const metadata=["preparedMilkAmount","remainingMilkAmount","sameBottle"];
        const facts=Object.fromEntries(Object.entries(after.facts).filter(([field])=>metadata.includes(field)));
        const states=Object.fromEntries(Object.entries(after.states).filter(([field])=>metadata.includes(field)));
        const evidence=after.evidence.filter(item=>metadata.includes(item.field));
        Object.assign(after,this.apply({...after,facts,states,evidence},{facts:legacyFacts(current)}));
      }
      // Set expected to the explicitly accepted latest snapshot, never silently overwrite it.
      return [{before:{...before,projected:current},after}];
    });
  }
  today() { return chinaDate(this.identity.now()); }
  async verifyCollectorReceipt(babyId:string,requestId:string,req:PayloadRequest,principal:Principal):Promise<boolean> {
    if(principal.kind!=="collector"||principal.babyId!==babyId)return false;
    const key=hash([babyId,principal.kind,principal.subjectId,"",principal.groupId||"",requestId]);
    const op=await this.repo.get<Operation>("care-operations",babyId,key,req);
    return !!op&&op.status==="done"&&op.actor.kind==="collector"&&op.actor.id===principal.subjectId;
  }
}
