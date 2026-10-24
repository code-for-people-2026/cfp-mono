import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import { digest, type IdentityService, type Principal } from "../identity";
import { hash, RecordsRepository } from "../records/persistence";
import { canonicalGroupId, type MediaResolution, type SourceCursor, type SourceMessage, type SourcePage } from "./types";
import type { CareEvent } from "../records/types";
import { baseMutation, identifier } from "../records/schemas";

const id = z.string().min(1).max(256);
const time = z.iso.datetime({ offset: true });
const range = z.object({ from: time, to: time }).strict().refine(value => Date.parse(value.from) <= Date.parse(value.to), "Invalid range");
const cursor = z.record(z.string(), z.number().int().nonnegative());
const media = z.object({ sourceId: id, kind: z.enum(["image", "voice", "video", "file"]), state: z.literal("unresolved"), fingerprint: z.string().max(100).optional(), reason: z.string().max(300) }).strict();
const mediaResolution = z.discriminatedUnion("state", [
  z.object({ sourceId: id, index: z.number().int().min(0).max(9), state: z.literal("uploaded"), attachmentId: id }).strict(),
  z.object({ sourceId: id, index: z.number().int().min(0).max(9), state: z.literal("unavailable"), reason: z.string().regex(/^[A-Z0-9_]{1,100}$/) }).strict(),
]);
export const sourceMessageSchema = z.object({
  sourceId: id, accountId: id, groupId: id, chatId: id, databaseId: id, tableName: id,
  localId: z.number().int().positive(), sentAt: time, senderId: id.nullable(),
  kind: z.enum(["text", "image", "voice", "video", "file", "system", "other"]), text: z.string().max(200_000), media: z.array(media).max(10),
}).strict();
export const collectorWriteTools = ["bubu_record_events", "bubu_update_event", "bubu_retract_event", "bubu_restore_event", "bubu_undo_event", "bubu_answer_pending", "bubu_attach_images", "bubu_resolve_duplicate"] as const;
export const agentPlanSchema = z.object({
  plans: z.array(z.object({ key: z.string().regex(/^[\w.-]{1,100}$/), sourceIds: z.array(id).min(1).max(100), tool: z.enum(collectorWriteTools), arguments: z.record(z.string(), z.unknown()) }).strict()).max(500),
  ignored: z.array(z.object({ sourceId: id, reason: z.string().trim().min(4).max(300) }).strict()).max(500),
}).strict();
export type AgentPlan = z.infer<typeof agentPlanSchema>;
const base = { babyId: id, jobId: id };
const leased = { ...base, batchId: id, runId: id };
export const collectorInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), babyId: id, accountId: id, chatId: id, agentId: id, enabled: z.boolean().default(false), intervalMs: z.number().int().min(10_000).max(86400_000).default(60000) }).strict(),
  z.object({ action: z.literal("status"), babyId: id, jobId: id.optional() }).strict(),
  z.object({ action: z.literal("backfill"), ...base, requestId: id, range }).strict(),
  z.object({ action: z.literal("retry"), ...base }).strict(),
  z.object({ action: z.literal("begin"), ...base, runId: id }).strict(),
  z.object({ action: z.literal("stage"), ...leased, page: z.object({ messages: z.array(sourceMessageSchema).max(500), nextCursor: cursor, hasMore: z.boolean() }).strict() }).strict(),
  z.object({ action: z.literal("media"), ...leased, resolutions: z.array(mediaResolution).max(5000) }).strict(),
  z.object({ action: z.literal("plan"), ...leased, plan: agentPlanSchema }).strict(),
  z.object({ action: z.literal("receipt"), ...leased, planKey: id, requestId: id }).strict(),
  z.object({ action: z.literal("finish"), ...leased }).strict(),
  z.object({ action: z.literal("heartbeat"), ...leased }).strict(),
  z.object({ action: z.literal("fail"), ...leased, code: z.string().regex(/^[A-Z0-9_]{1,80}$/) }).strict(),
]);
interface Backfill { id: string; range: { from: string; to: string }; cursor: SourceCursor; state: "queued" | "completed" }
export interface CollectorJob {
  id: string; babyId: string; groupId: string; accountId: string; chatId: string; agentId: string;
  enabled: boolean; intervalMs: number; cursor: SourceCursor; nextRunAt: string;
  heartbeatAt?: string; lastSuccessAt?: string; processedThrough?: string; failure?: { code: string; at: string; attempts: number };
  activeBatchId?: string; backfills: Backfill[]; pendingMedia?: number;
}
export interface CollectorBatch {
  id: string; jobId: string; babyId: string; groupId: string; state: "reading" | "processing" | "retry" | "completed";
  runId: string; leaseUntil: string; startedAt: string; heartbeatAt: string; attempts: number;
  cursor: SourceCursor; nextCursor?: SourceCursor; hasMore?: boolean; backfillId?: string; range?: { from: string; to: string };
  messages?: SourceMessage[]; skippedSourceIds?: string[]; sourceThrough?: string; plan?: AgentPlan; media?: MediaResolution[];
  /** Already consumed care sources may only repair images on their existing events. */
  mediaOnly?: Record<string, string[]>;
  receipts: Record<string, { requestId: string; at: string }>; failure?: { code: string; at: string };
}
interface StoredMessage { privacyExpired?: boolean; source: SourceMessage; contentHash: string; state: "pending" | "processed" | "ignored"; batchId: string; reason?: string; media?: MediaResolution[]; mediaPending?: boolean; mediaResolutions?: HumanMediaResolution[] }
interface HumanMediaResolution { index: number; eventId: string; resolution: "provided" | "unknown"; attachmentId?: string; requestId: string; requestHash: string; actor: string; resolvedAt: string; result: { kind: "media"; id: string; sourceId: string; state: "resolved" | "open"; resolution: "provided" | "unknown" } }
export const resolveMediaSchema = baseMutation.extend({ pendingId: identifier, eventId: identifier, expectedVersion: z.number().int().positive(), attachmentId: identifier.optional(), mediaIndex: z.number().int().min(0).max(9).default(0), resolution: z.enum(["provided", "unknown"]).default("provided") })
  .refine(input => input.resolution === "provided" ? !!input.attachmentId : input.attachmentId === undefined, "provided requires an attachment; unknown must not claim one");
type ReceiptVerifier = (babyId: string, requestId: string, req: PayloadRequest, principal: Principal) => Promise<boolean>;
/** @public Unresolved media contract consumed by downstream chat and operations views. */
export interface PendingMedia {
  kind: "media"; id: string; sourceId: string; babyId: string; eventIds: string[];
  source: { kind: "wechat"; accountId: string; conversationId: string; messageId: string; sentAt: string; senderId: string; groupId: string };
  media: Array<{ index: number; kind: string; state: "unavailable" | "unlinked"; reason: string; attachmentId?: string }>;
  state: "open"; resolution: "protected_upload_and_attach_or_backfill";
}
export const collectorRequestId = (batchId: string, planKey: string) => `collector-${hash([batchId, planKey]).slice(0, 48)}`;
const fail = (code: string, status = 409): never => { throw new AppError(status, code, code); };
const visibleToGroup = (event: CareEvent, groupId: string) => event.sources.some(source => source.kind === "wechat" && source.groupId === groupId)
  && !event.sources.some(source => source.kind === "wechat" && source.groupId !== groupId);
const hasSource = (event: CareEvent, source: SourceMessage) => event.sources.some(ref => ref.kind === "wechat" && ref.groupId === source.groupId && ref.accountId === source.accountId && ref.conversationId === source.chatId && ref.messageId === `${source.databaseId}/${source.tableName}/${source.localId}`);

/** Durable job control. The transport authenticates every call; this service rechecks scope. */
export class CollectorService {
  readonly repository: RecordsRepository;
  constructor(readonly identity: IdentityService, readonly verifyReceipt: ReceiptVerifier, private readonly safetySignal?: (babyId: string, source: SourceMessage, req: PayloadRequest) => Promise<void>) {
    this.repository = new RecordsRepository(identity.store.payload);
  }
  private now() { return new Date(this.identity.now()).toISOString(); }
  private async authorized<T>(principal: Principal, babyId: string, groupId: string | undefined, action: (req: PayloadRequest) => Promise<T>) {
    if (principal.kind !== "operator" && principal.kind !== "collector") return fail("COLLECTOR_SCOPE_REQUIRED", 403);
    return this.identity.executeAuthorized(principal, babyId, "records:write", (_scope, req) => action(req), principal.kind === "collector" ? groupId : undefined);
  }
  private operator(principal: Principal) { if (principal.kind !== "operator") fail("OPERATOR_REQUIRED", 403); }
  private async job(principal: Principal, input: { babyId: string; jobId: string }, req: PayloadRequest) {
    const job = await this.repository.get<CollectorJob>("care-sync", input.babyId, input.jobId, req);
    if (!job || (principal.kind === "collector" && (job.groupId !== principal.groupId || job.agentId !== principal.subjectId))) return fail("COLLECTOR_JOB_NOT_FOUND", 404);
    return job;
  }
  private async saveJob(job: CollectorJob, req: PayloadRequest) { await this.repository.put("care-sync", job.babyId, job.id, job, req); }
  private async saveBatch(batch: CollectorBatch, req: PayloadRequest) { await this.repository.put("care-batches", batch.babyId, batch.id, batch, req); }
  private async bound(job: CollectorJob) {
    const binding = await this.identity.store.get("group-bindings", digest(job.groupId));
    if (!binding || binding.value.active !== true || binding.value.babyId !== job.babyId || binding.value.agentId !== job.agentId) fail("COLLECTOR_BINDING_INACTIVE", 403);
  }
  private async leased(job: CollectorJob, input: { batchId: string; runId: string }, req: PayloadRequest) {
    const batch = await this.repository.get<CollectorBatch>("care-batches", job.babyId, input.batchId, req);
    if (!batch || job.activeBatchId !== batch.id || batch.runId !== input.runId || batch.state === "completed" || Date.parse(batch.leaseUntil) <= this.identity.now()) return fail("COLLECTOR_LEASE_LOST");
    return batch;
  }
  /** Read-side continuation for both the built-in chat and authorized collectors. */
  async pendingMedia(principal: Principal, babyId: string): Promise<PendingMedia[]> {
    return this.identity.executeAuthorized(principal, babyId, "records:read", async (scope, req) => {
      const messages = await this.repository.list<StoredMessage>("care-messages", babyId, req);
      const events = (await this.repository.list<CareEvent>("care-events", babyId, req)).filter(event => event.lifecycle === "active" && (scope.actor.kind !== "collector" || visibleToGroup(event, scope.groupId!)));
      const attachments = await this.repository.list<{ id: string; source?: { kind: string; groupId?: string; accountId: string; conversationId: string; messageId: string; eventKey: string } }>("care-attachments", babyId, req);
      const result: PendingMedia[] = [];
      for (const stored of messages) {
        const source = stored.source;
        if (!stored.mediaPending || (scope.actor.kind === "collector" && source.groupId !== scope.groupId)) continue;
        const messageId = `${source.databaseId}/${source.tableName}/${source.localId}`;
        const targets = events.filter(event => event.sources.some(ref => ref.kind === "wechat" && ref.groupId === source.groupId && ref.accountId === source.accountId && ref.conversationId === source.chatId && ref.messageId === messageId));
        if (!targets.length) continue;
        const linked = new Set(targets.flatMap(event => event.attachmentIds));
        const unresolved: PendingMedia["media"] = [];
        for (const [index, item] of source.media.entries()) {
          if (stored.mediaResolutions?.some(resolution => resolution.index === index)) continue;
          // Exact collector upload+link can close a follow-up even before the
          // next backfill. Unrelated event photos cannot satisfy this source.
          const resolved = attachments.some(attachment => linked.has(attachment.id) && attachment.source?.kind === "wechat" && attachment.source.groupId === source.groupId && attachment.source.accountId === source.accountId && attachment.source.conversationId === source.chatId && attachment.source.messageId === messageId && attachment.source.eventKey === `media:${index}`);
          if (resolved) continue;
          const previous = stored.media?.find(media => media.index === index);
          unresolved.push({ index, kind: item.kind, state: previous?.state === "uploaded" ? "unlinked" : "unavailable", reason: previous?.reason || (previous?.state === "uploaded" ? "MEDIA_NOT_LINKED" : "MEDIA_UNAVAILABLE"), ...(previous?.attachmentId ? { attachmentId: previous.attachmentId } : {}) });
        }
        if (unresolved.length) result.push({ kind: "media", id: `media:${source.sourceId}`, sourceId: source.sourceId, babyId, eventIds: targets.map(event => event.id),
          source: { kind: "wechat", accountId: source.accountId, conversationId: source.chatId, messageId, sentAt: source.sentAt, senderId: source.senderId || "unknown", groupId: source.groupId },
          media: unresolved, state: "open", resolution: "protected_upload_and_attach_or_backfill" });
      }
      return result;
    }, principal.kind === "collector" ? principal.groupId : undefined);
  }
  /** Explicit human continuation after a private upload and versioned core attach. */
  async resolveMedia(principal: Principal, raw: z.input<typeof resolveMediaSchema>) {
    const input = resolveMediaSchema.parse(raw);
    // CMS delegates identify a signed-in human operator. executeAuthorized
    // rechecks that account's current role/scope; CLI and collector tokens do not qualify.
    if (principal.kind !== "caregiver" && principal.kind !== "chat-agent" && !(principal.kind === "operator" && principal.operatorUserId)) return fail("MEDIA_HUMAN_CONFIRMATION_REQUIRED", 403);
    return this.identity.executeAuthorized(principal, input.babyId, "records:write", async (scope, req) => {
      await this.identity.assertService(input.babyId, "chat", req);
      if (!scope.permissions.includes("media:write")) return fail("MEDIA_WRITE_REQUIRED", 403);
      const sourceId = input.pendingId.startsWith("media:") ? input.pendingId.slice(6) : "";
      const stored = await this.repository.get<StoredMessage>("care-messages", input.babyId, sourceId, req);
      if (!stored || !stored.source.media[input.mediaIndex]) return fail("MEDIA_PENDING_NOT_FOUND", 404);
      const actor = hash([scope.actor.kind, scope.actor.id, scope.actor.onBehalfOf || ""]), requestHash = hash(input);
      const previous = stored.mediaResolutions?.find(resolution => resolution.actor === actor && resolution.requestId === input.requestId);
      if (previous) { if (previous.requestHash !== requestHash) return fail("COLLECTOR_REQUEST_REUSED"); return previous.result; }
      if (!stored.mediaPending || stored.mediaResolutions?.some(resolution => resolution.index === input.mediaIndex)) return fail("MEDIA_PENDING_CLOSED");
      if (stored.source.media[input.mediaIndex]!.kind !== "image") return fail("MEDIA_TYPE_NOT_SUPPORTED", 400);
      const event = await this.repository.get<CareEvent>("care-events", input.babyId, input.eventId, req);
      if (!event || !event.sources.some(ref => ref.kind === "wechat" && ref.groupId === stored.source.groupId && ref.accountId === stored.source.accountId && ref.conversationId === stored.source.chatId && ref.messageId === `${stored.source.databaseId}/${stored.source.tableName}/${stored.source.localId}`)) return fail("MEDIA_EVENT_MISMATCH", 404);
      if (event.version !== input.expectedVersion) return fail("VERSION_CONFLICT");
      if (event.lifecycle !== "active") return fail("EVENT_INACTIVE");
      if (input.resolution === "provided" && (!event.attachmentIds.includes(input.attachmentId!) || !await this.repository.get("care-attachments", input.babyId, input.attachmentId!, req))) return fail("MEDIA_ATTACHMENT_NOT_LINKED");
      const resolvedIndexes = new Set([input.mediaIndex, ...(stored.mediaResolutions || []).map(resolution => resolution.index)]);
      stored.mediaPending = stored.source.media.some((_media, index) => !resolvedIndexes.has(index) && !stored.media?.some(media => media.index === index && media.state === "uploaded" && event.attachmentIds.includes(media.attachmentId!)));
      const result = { kind: "media" as const, id: input.pendingId, sourceId, state: stored.mediaPending ? "open" as const : "resolved" as const, resolution: input.resolution };
      stored.mediaResolutions = [...(stored.mediaResolutions || []), { index: input.mediaIndex, eventId: event.id, resolution: input.resolution, ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}), requestId: input.requestId, requestHash, actor, resolvedAt: this.now(), result }];
      await this.repository.put("care-messages", input.babyId, sourceId, stored, req);
      return result;
    });
  }
  async dispatch(principal: Principal, raw: unknown): Promise<unknown> {
    const input = collectorInputSchema.parse(raw);
    const groupId = input.action === "configure" ? canonicalGroupId(input.accountId, input.chatId) : principal.groupId;
    return this.authorized(principal, input.babyId, groupId, async req => {
      if (input.action === "configure") {
        this.operator(principal);
        const jobId = `collector:${hash([input.babyId, groupId])}`;
        const previous = await this.repository.get<CollectorJob>("care-sync", input.babyId, jobId, req);
        if (previous?.activeBatchId && previous.agentId !== input.agentId) fail("COLLECTOR_BATCH_ACTIVE");
        const job: CollectorJob = { ...previous, id: jobId, babyId: input.babyId, groupId: groupId!, accountId: input.accountId, chatId: input.chatId, agentId: input.agentId, enabled: input.enabled, intervalMs: input.intervalMs, cursor: previous?.cursor || {}, nextRunAt: previous?.nextRunAt || this.now(), backfills: previous?.backfills || [] };
        await this.bound(job);
        await this.saveJob(job, req);
        return { job };
      }
      if (input.action === "status") {
        if (input.jobId) return { job: await this.job(principal, { babyId: input.babyId, jobId: input.jobId }, req) };
        const jobs = await this.repository.list<CollectorJob>("care-sync", input.babyId, req);
        return { jobs: jobs.filter(job => job.id.startsWith("collector:") && (principal.kind === "operator" || job.groupId === principal.groupId && job.agentId === principal.subjectId)) };
      }
      const job = await this.job(principal, input, req);
      if (input.action === "backfill") {
        this.operator(principal);
        const existing = job.backfills.find(item => item.id === input.requestId);
        if (existing && hash(existing.range) !== hash(input.range)) fail("COLLECTOR_REQUEST_REUSED");
        if (!existing) job.backfills.push({ id: input.requestId, range: input.range, cursor: {}, state: "queued" });
        job.nextRunAt = this.now();
        await this.saveJob(job, req);
        return { job };
      }
      if (input.action === "retry") {
        this.operator(principal);
        job.nextRunAt = this.now();
        await this.saveJob(job, req);
        return { job };
      }
      if (principal.kind !== "collector") return fail("COLLECTOR_CREDENTIAL_REQUIRED", 403);
      await this.bound(job);
      if (!job.enabled) return { skipped: true, reason: "disabled", job };
      // Failure checkpoints can release the current lease during a service pause.
      // Every advancing boundary must re-read eligibility before changing progress.
      if (input.action !== "fail") await this.identity.assertService(input.babyId, "collection", req);
      if (input.action === "begin") {
        if (Date.parse(job.nextRunAt) > this.identity.now()) return { skipped: true, reason: "not_due", job };
        let batch = job.activeBatchId ? await this.repository.get<CollectorBatch>("care-batches", job.babyId, job.activeBatchId, req) : undefined;
        if (batch && batch.runId !== input.runId && Date.parse(batch.leaseUntil) > this.identity.now()) return fail("COLLECTOR_BUSY");
        if (!batch) {
          const backfill = job.backfills.find(item => item.state === "queued");
          batch = { id: `collection:${randomUUID()}`, jobId: job.id, babyId: job.babyId, groupId: job.groupId, state: "reading", runId: input.runId, leaseUntil: this.now(), startedAt: this.now(), heartbeatAt: this.now(), attempts: 0,
            cursor: backfill ? backfill.cursor : job.cursor, ...(backfill ? { backfillId: backfill.id, range: backfill.range } : {}), receipts: {} };
          job.activeBatchId = batch.id;
        }
        batch.runId = input.runId; batch.attempts += 1; batch.heartbeatAt = this.now();
        batch.leaseUntil = new Date(this.identity.now() + 120_000).toISOString();
        if (batch.state === "retry") batch.state = batch.messages ? "processing" : "reading";
        job.heartbeatAt = this.now();
        await this.saveBatch(batch, req); await this.saveJob(job, req);
        return { job, batch };
      }
      const batch = await this.leased(job, input, req);
      if (input.action === "stage") await this.stage(job, batch, input.page, req);
      if (input.action === "media") {
        if (!batch.messages) fail("COLLECTOR_PAGE_REQUIRED");
        if (batch.plan && hash(batch.media) !== hash(input.resolutions)) fail("COLLECTOR_PLAN_IMMUTABLE");
        const keys = new Set<string>();
        for (const resolution of input.resolutions) {
          const message = batch.messages!.find(message => message.sourceId === resolution.sourceId);
          const key = `${resolution.sourceId}:${resolution.index}`;
          if (!message?.media[resolution.index] || keys.has(key)) fail("COLLECTOR_MEDIA_MISMATCH");
          keys.add(key);
          if (resolution.state === "uploaded") {
            const attachment = await this.repository.get<{ uploadedBy: { kind: string; id: string }; source?: { groupId?: string; messageId: string; accountId: string; conversationId: string; eventKey: string } }>("care-attachments", job.babyId, resolution.attachmentId, req);
            if (!attachment || attachment.uploadedBy.kind !== principal.kind || attachment.uploadedBy.id !== principal.subjectId || attachment.source?.groupId !== job.groupId || attachment.source.accountId !== job.accountId || attachment.source.conversationId !== job.chatId || attachment.source.messageId !== `${message!.databaseId}/${message!.tableName}/${message!.localId}` || attachment.source.eventKey !== `media:${resolution.index}`) fail("COLLECTOR_MEDIA_NOT_COMMITTED");
          }
        }
        if (keys.size !== batch.messages!.reduce((count, message) => count + message.media.length, 0)) fail("COLLECTOR_MEDIA_INCOMPLETE");
        batch.media = input.resolutions;
      }
      if (input.action === "plan") {
        if (!batch.messages) fail("COLLECTOR_PAGE_REQUIRED");
        if (batch.messages!.some(message => message.media.length) && !batch.media) fail("COLLECTOR_MEDIA_INCOMPLETE");
        if (batch.plan && hash(batch.plan) !== hash(input.plan)) fail("COLLECTOR_PLAN_IMMUTABLE");
        const sourceIds = new Set(batch.messages!.map(message => message.sourceId));
        const covered = new Set<string>();
        const planKeys = new Set<string>();
        const events = (await this.repository.list<CareEvent>("care-events", job.babyId, req)).filter(event => visibleToGroup(event, job.groupId));
        // Fact processing already finished for these sources. A media retry may
        // finish with no write (still unavailable, or all target facts retired),
        // but can never reclassify the source or create/restore another fact.
        for (const sourceId of Object.keys(batch.mediaOnly || {})) covered.add(sourceId);
        for (const plan of input.plan.plans) {
          if (planKeys.has(plan.key)) fail("COLLECTOR_DUPLICATE_PLAN_KEY");
          planKeys.add(plan.key);
          for (const sourceId of plan.sourceIds) {
            if (!sourceIds.has(sourceId)) fail("COLLECTOR_SOURCE_MISMATCH");
            const targets = batch.mediaOnly?.[sourceId];
            if (targets && (plan.tool !== "bubu_attach_images" || !events.some(event => event.id === plan.arguments.eventId && event.lifecycle === "active" && targets.includes(event.id)))) fail("COLLECTOR_MEDIA_ONLY_SOURCE");
            covered.add(sourceId);
          }
        }
        for (const ignored of input.plan.ignored) {
          if (!sourceIds.has(ignored.sourceId) || covered.has(ignored.sourceId)) fail("COLLECTOR_SOURCE_MISMATCH");
          covered.add(ignored.sourceId);
        }
        if (covered.size !== sourceIds.size) fail("COLLECTOR_UNPROCESSED_MESSAGES");
        batch.plan = input.plan;
      }
      if (input.action === "receipt") {
        if (!batch.plan?.plans.some(plan => plan.key === input.planKey) || input.requestId !== collectorRequestId(batch.id, input.planKey)) fail("COLLECTOR_RECEIPT_MISMATCH");
        if (!await this.verifyReceipt(job.babyId, input.requestId, req, principal)) fail("COLLECTOR_WRITE_NOT_COMMITTED");
        batch.receipts[input.planKey] = { requestId: input.requestId, at: this.now() };
      }
      if (input.action === "finish") {
        if (!batch.plan || !batch.nextCursor || batch.plan.plans.some(plan => !batch.receipts[plan.key])) fail("COLLECTOR_UNPROCESSED_MESSAGES");
        const activeEvents = (await this.repository.list<CareEvent>("care-events", job.babyId, req)).filter(event => event.lifecycle === "active");
        const attached = new Set(activeEvents.flatMap(event => event.attachmentIds));
        for (const message of batch.messages || []) {
          const stored = (await this.repository.get<StoredMessage>("care-messages", job.babyId, message.sourceId, req))!;
          const ignored = batch.plan!.ignored.find(item => item.sourceId === message.sourceId);
          stored.state = ignored ? "ignored" : "processed";
          if (ignored) stored.reason = ignored.reason;
          stored.media = batch.media?.filter(media => media.sourceId === message.sourceId) || [];
          // A durable follow-up survives cursor advancement. Backfill retries
          // these messages; an explicit non-care ignore reason closes it.
          const retired = batch.mediaOnly?.[message.sourceId] && !activeEvents.some(event => hasSource(event, message));
          stored.mediaPending = !ignored && !retired && stored.media.some(media => !stored.mediaResolutions?.some(resolution => resolution.index === media.index) && (media.state === "unavailable" || !attached.has(media.attachmentId!)));
          await this.repository.put("care-messages", job.babyId, message.sourceId, stored, req);
        }
        job.pendingMedia = (await this.repository.list<StoredMessage>("care-messages", job.babyId, req)).filter(message => message.source.groupId === job.groupId && message.mediaPending).length;
        if (batch.backfillId) {
          const backfill = job.backfills.find(item => item.id === batch.backfillId)!;
          backfill.cursor = batch.nextCursor!;
          if (!batch.hasMore) backfill.state = "completed";
        } else job.cursor = batch.nextCursor!;
        batch.state = "completed"; delete job.activeBatchId; delete job.failure;
        job.lastSuccessAt = this.now();
        if (batch.sourceThrough && (!job.processedThrough || Date.parse(batch.sourceThrough) > Date.parse(job.processedThrough))) job.processedThrough = batch.sourceThrough;
        job.nextRunAt = new Date(this.identity.now() + (batch.hasMore ? 0 : job.intervalMs)).toISOString();
      }
      if (input.action === "fail") {
        batch.state = "retry"; batch.failure = { code: input.code, at: this.now() };
        batch.leaseUntil = this.now();
        job.failure = { ...batch.failure, attempts: batch.attempts };
        job.nextRunAt = new Date(this.identity.now() + Math.min(300_000, 1000 * 2 ** Math.min(batch.attempts, 8))).toISOString();
      } else batch.leaseUntil = new Date(this.identity.now() + 120_000).toISOString();
      batch.heartbeatAt = this.now(); job.heartbeatAt = this.now();
      await this.saveBatch(batch, req); await this.saveJob(job, req);
      return { job, batch };
    });
  }
  private async stage(job: CollectorJob, batch: CollectorBatch, page: SourcePage, req: PayloadRequest) {
    if (batch.messages) {
      // A lost response after staging can retry the same source page safely.
      if (hash(batch.nextCursor) !== hash(page.nextCursor)) fail("COLLECTOR_PAGE_IMMUTABLE");
      return;
    }
    const nextCursor = { ...batch.cursor };
    const unique = new Set<string>();
    const pending: SourceMessage[] = []; const skipped: string[] = [];
    const mediaOnly: Record<string, string[]> = {};
    const events = (await this.repository.list<CareEvent>("care-events", job.babyId, req)).filter(event => visibleToGroup(event, job.groupId));
    for (const source of page.messages) {
      const table = `Msg_${createHash("md5").update(job.chatId).digest("hex")}`;
      const expected = `wechat:${hash(["wechat", job.accountId, source.databaseId, table, source.localId])}`;
      if (source.groupId !== job.groupId || source.accountId !== job.accountId || source.chatId !== job.chatId || !/^message\/message_\d+\.db$/.test(source.databaseId) || source.tableName !== table || source.sourceId !== expected || unique.has(source.sourceId)) fail("COLLECTOR_SOURCE_MISMATCH");
      if (source.media.some(item => item.sourceId !== source.sourceId)) fail("COLLECTOR_SOURCE_MISMATCH");
      unique.add(source.sourceId);
      await this.safetySignal?.(job.babyId, source, req);
      const stream = `${source.databaseId}:${table}`;
      if (source.localId <= (nextCursor[stream] || 0)) fail("COLLECTOR_CURSOR_REGRESSION");
      nextCursor[stream] = source.localId;
      const existing = await this.repository.get<StoredMessage>("care-messages", job.babyId, source.sourceId, req);
      if (existing && existing.contentHash !== hash(source)) fail("COLLECTOR_SOURCE_CHANGED");
      if (existing && existing.state !== "pending" && !existing.mediaPending) { skipped.push(source.sourceId); continue; }
      if (existing && existing.state !== "pending" && existing.mediaPending) {
        mediaOnly[source.sourceId] = events.filter(event => event.sources.some(ref => ref.kind === "wechat" && ref.groupId === job.groupId && ref.accountId === source.accountId && ref.conversationId === source.chatId && ref.messageId === `${source.databaseId}/${source.tableName}/${source.localId}`)).map(event => event.id);
      }
      await this.repository.put<StoredMessage>("care-messages", job.babyId, source.sourceId, { ...existing, source, contentHash: hash(source), state: "pending", batchId: batch.id, ...(existing?.privacyExpired ? { source: { ...source, text: "" } } : {}) }, req);
      pending.push(source);
    }
    if (hash(nextCursor) !== hash(page.nextCursor)) fail("COLLECTOR_CURSOR_MISMATCH");
    batch.messages = pending; batch.skippedSourceIds = skipped; batch.nextCursor = nextCursor; batch.hasMore = page.hasMore; batch.state = "processing"; batch.mediaOnly = mediaOnly;
    if (page.messages.length) batch.sourceThrough = page.messages.reduce((latest, message) => Date.parse(message.sentAt) > Date.parse(latest) ? message.sentAt : latest, page.messages[0]!.sentAt);
  }
}
