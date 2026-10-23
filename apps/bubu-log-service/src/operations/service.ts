import type { PayloadRequest } from "payload";
import { AppError, permissions, type Permission } from "../contracts";
import { type IdentityService, type Principal } from "../identity";
import type { Store } from "../store";
import { hash, RecordsRepository } from "../records/persistence";
import type { CareEvent, PendingQuestion } from "../records/types";
import type { RecordsService } from "../records/service";
import type { AttachmentService } from "../records/attachments";
import type { CollectorService, CollectorJob } from "../collector/service";
import { ChatMcpClient as RecordsMcpClient } from "../chat/mcp";
import { auditHistory, parseHistorySnapshot } from "../records/history-audit";
import { protectRecordPhotos } from "../media";
import { readOpsUser, requireBaby, type OpsUser } from "./access";
import { appendOpsAudit } from "./audit";
import { redactOperations } from "./redaction";
import { type MembershipOperations, type OpsAction, type OpsRead } from "./contracts";

export interface OperationsRuntime {
  identity: IdentityService; records: RecordsService; attachments: AttachmentService; collector: CollectorService;
  store: Store; mcpUrl: string; opsOrigin: string;
}
interface RequestEntry { fingerprint: string; state: "running" | "completed" | "retry"; receipt?: unknown }
const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const readPermissions: Permission[] = ["records:read", "media:read"];
function eventSummary(event: CareEvent) {
  return { id: event.id, version: event.version, type: event.facts.type, startTime: event.facts.startTime,
    lifecycle: event.lifecycle, projection: event.projection, complete: event.complete, attachmentIds: event.attachmentIds,
    missing: event.missing, conflictCount: event.conflicts.length };
}
/** The ledger holds receipts/identifiers only. Care facts continue to have one authoritative representation. */
function receiptSummary(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const row = value as Record<string, unknown>;
  if (Array.isArray(row.events)) return { requestId: row.requestId, status: row.status, retryable: row.retryable,
    events: row.events.map(event => { const item = event as CareEvent; return { id: item.id, version: item.version, lifecycle: item.lifecycle, projection: item.projection }; }),
    questions: Array.isArray(row.questions) ? row.questions.map(question => { const item = question as PendingQuestion; return { id: item.id, version: item.version, eventId: item.eventId }; }) : [] };
  if (row.job && typeof row.job === "object") { const job = row.job as CollectorJob; return { job: { id: job.id, enabled: job.enabled, nextRunAt: job.nextRunAt, backfills: job.backfills.map(item => ({ id: item.id, state: item.state })) } }; }
  return redactOperations(value);
}
export class OperationsService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly repo: RecordsRepository;
  constructor(readonly runtime: OperationsRuntime, readonly membership?: MembershipOperations) {
    this.repo = new RecordsRepository(runtime.store.payload);
    runtime.identity.setOperatorGuard(async (userId, babyId, permission) => {
      const user = await readOpsUser(runtime.store.payload, { id: userId, collection: "ops-users" });
      requireBaby(user, babyId, !readPermissions.includes(permission));
    });
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action); this.queue = result.catch(() => undefined); return result;
  }
  private async user(raw: OpsUser, babyId: string, write = false) {
    const user = await readOpsUser(this.runtime.store.payload, raw); requireBaby(user, babyId, write); return user;
  }
  private async withPrincipal<T>(user: OpsUser, babyId: string, write: boolean, action: (principal: Principal, token: string) => Promise<T>, keepForInvite = false): Promise<T> {
    await this.user(user, babyId, write);
    const issued = await this.runtime.identity.provisionOperator(`ops:${user.id}`, babyId, keepForInvite ? 86400_000 : 15 * 60_000,
      { userId: String(user.id), permissions: write ? permissions : readPermissions });
    const principal = await this.runtime.identity.authenticate(issued.token, "bearer");
    try { return await action(principal, issued.token); }
    finally { if (!keepForInvite) await this.runtime.identity.logout(principal); }
  }
  async context(raw: OpsUser) {
    const user = await readOpsUser(this.runtime.store.payload, raw);
    const babies = (await Promise.all(user.babyIds.map(id => this.runtime.identity.legacy.getBaby(id)))).filter(Boolean);
    const accountAudit = user.role === "administrator" ? (await this.runtime.store.list("audit"))
      .filter(row => !row.value.babyId && ["ops.login", "ops.account.create", "ops.account.update", "ops.account.delete"].includes(String(row.value.action)))
      .slice(0, 100).map(({ id, value }) => ({ id, actorId: value.actorId, action: value.action, at: value.at, reason: value.reason, target: redactOperations(value.target), result: redactOperations(value.result) })) : undefined;
    return { user, babies, accountAudit, membership: { configured: !!this.membership } };
  }
  async overview(raw: OpsUser, babyId: string) {
    const user = await this.user(raw, babyId);
    return this.withPrincipal(user, babyId, false, async principal => {
      const baby = await this.runtime.identity.legacy.getBaby(babyId);
      const data = await this.runtime.identity.executeAuthorized(principal, babyId, "records:read", async (_scope, req) => {
        const values = async (table: "grants" | "group-bindings") => (await this.runtime.store.list(table)).filter(row => row.value.babyId === babyId).map(row => redactOperations(row.value));
        const grants = await values("grants");
        // Old BabyUser remains authoritative; show inherited access without copying it into sidecar grants.
        for (const row of await this.runtime.store.list("identities")) {
          if (!row.key.startsWith("subject:") || typeof row.value.legacyUserId !== "string") continue;
          const subjectId = String(row.value.id);
          if (grants.some(item => (item as Record<string, unknown>).subjectId === subjectId)) continue;
          if (await this.runtime.identity.legacy.userExists(row.value.legacyUserId) && (await this.runtime.identity.legacy.listBabies(row.value.legacyUserId)).some(item => item.id === babyId))
            grants.push({ subjectId, state: "active", permissions: permissions.filter(permission => permission !== "caregivers:manage"), source: "legacy" });
        }
        const jobs = (await this.repo.list<CollectorJob>("care-sync", babyId, req)).filter(job => job.id.startsWith("collector:"));
        const audit = (await this.runtime.store.list("audit")).filter(row => row.value.babyId === babyId).slice(0, 100).map(row => ({ id: row.id, ...redactOperations(row.value) as object }));
        await appendOpsAudit(this.runtime.store.payload, { actorId: user.id, babyId, action: "ops.overview", reason: "运营范围内的进度与授权核对" }, req);
        return { grants, bindings: await values("group-bindings"), jobs, audit };
      });
      // The shared read model includes untouched legacy Activity rows without copying them into sidecar.
      const events = (await this.runtime.records.query(principal, { babyId, includeRetracted: true })).events.map(eventSummary);
      const pending = [...await this.runtime.records.pending(principal, babyId), ...(await this.runtime.collector.pendingMedia(principal, babyId)).map(question => ({ kind: "media", id: question.id, eventIds: question.eventIds, state: question.state, sourceId: question.sourceId,
        media: question.media.map(item => ({ index: item.index, kind: item.kind, state: item.state, reason: item.reason, attachmentId: item.attachmentId })) }))];
      const membership = this.membership ? await this.membership.read(principal, babyId) : { configured: false };
      return { baby, ...data, events, pending, membership };
    });
  }
  private requestKey(user: OpsUser, input: OpsAction) { return `ops:${hash([user.id, input.babyId, input.requestId])}`; }
  private async entry(key: string, req: PayloadRequest): Promise<RequestEntry | undefined> {
    const row = (await this.runtime.store.payload.find({ collection: "ops-requests", where: { key: { equals: key } }, limit: 1, overrideAccess: true, req })).docs[0];
    return row?.value as RequestEntry | undefined;
  }
  private async saveEntry(key: string, babyId: string, value: RequestEntry, req: PayloadRequest) {
    const payload = this.runtime.store.payload;
    const row = (await payload.find({ collection: "ops-requests", where: { key: { equals: key } }, limit: 1, overrideAccess: true, req })).docs[0];
    if (row) await payload.update({ collection: "ops-requests", id: row.id, data: { value }, overrideAccess: true, req });
    else await payload.create({ collection: "ops-requests", data: { id: key, key, babyId, value }, overrideAccess: true, req });
  }
  async execute(raw: OpsUser, input: OpsAction): Promise<unknown> {
    return this.serial(async () => {
      const user = await this.user(raw, input.babyId, true), key = this.requestKey(user, input), fingerprint = hash(input);
      const previous = await this.runtime.identity.exclusive(() => this.runtime.store.transaction(req => this.entry(key, req)));
      if (previous && previous.fingerprint !== fingerprint) return fail(409, "OPS_REQUEST_REUSED", "此请求号已用于其他操作；请核对后发起新请求。");
      if (previous?.state === "completed") return previous.receipt;
      // Identity/configuration actions and their receipt/audit share the same SQLite transaction.
      if (!["record", "baby", "membership"].includes(input.command.type)) { try { return await this.runtime.identity.exclusive(async () => {
        const result = await this.withPrincipal(user, input.babyId, true, principal => this.identityAction(principal, input), input.command.type === "invite");
        const once = input.command.type === "invite" || input.command.type === "credential";
        const receipt = once ? { ...redactOperations(result) as object, code: undefined, alreadyIssued: true, message: "凭证已签发且只显示一次；遗失时请重新签发。" } : receiptSummary(result);
        await this.runtime.store.transaction(async req => {
          await this.saveEntry(key, input.babyId, { fingerprint, state: "completed", receipt }, req);
          await this.audit(user, input, "completed", req);
        });
        return once ? result : receipt;
      }); } catch (error) {
        await this.runtime.identity.exclusive(() => this.runtime.store.transaction(req => this.audit(user, input, error instanceof AppError ? error.code : "FAILED", req)));
        throw error;
      } }
      await this.runtime.identity.exclusive(() => this.runtime.store.transaction(async req => {
        await this.saveEntry(key, input.babyId, { fingerprint, state: "running" }, req);
        await this.audit(user, input, "started", req);
      }));
      try {
        const value = await this.withPrincipal(user, input.babyId, true, async (principal, token) => {
          const command = input.command;
          if (command.type === "record") {
            if ("babyId" in command.arguments || (command.tool !== "bubu_get_request" && "requestId" in command.arguments)) return fail(400, "OPS_SCOPE_OVERRIDE", "宝宝与请求号由运营入口固定。");
            const client = new RecordsMcpClient(this.runtime.mcpUrl, token);
            try { await client.connect(); return await client.call(command.tool, { ...command.arguments, babyId: input.babyId, requestId: command.tool === "bubu_get_request" ? command.arguments.requestId : input.requestId }); }
            finally { await client.close(); }
          }
          if (command.type === "baby") {
            await this.runtime.identity.authorize(principal, input.babyId, "baby:manage");
            const others = (await this.context(user)).babies;
            if (others.some(baby => baby && baby.id !== input.babyId && baby.name.trim().toLowerCase() === command.name.toLowerCase())) return fail(409, "DUPLICATE_NAME", "运营范围内已存在同名宝宝。");
            return this.runtime.identity.legacy.updateBabyNames(input.babyId, { name: command.name, fullName: command.fullName });
          }
          if (command.type === "membership" && this.membership) return this.membership.execute(principal, input.babyId, input.requestId, this.membership.schema.parse(command.input));
          return fail(409, "MEMBERSHIP_NOT_CONFIGURED", "会员模块尚未接入；未设置收费、截止或到期停服策略。");
        });
        const receipt = receiptSummary(value);
        const retry = !!value && typeof value === "object" && (value as Record<string, unknown>).status === "pending_projection";
        await this.runtime.identity.exclusive(() => this.runtime.store.transaction(async req => {
          await this.saveEntry(key, input.babyId, { fingerprint, state: retry ? "retry" : "completed", receipt }, req);
          await this.audit(user, input, retry ? "retry" : "completed", req);
        }));
        return receipt;
      } catch (error) {
        await this.runtime.identity.exclusive(() => this.runtime.store.transaction(async req => { await this.saveEntry(key, input.babyId, { fingerprint, state: "retry" }, req); await this.audit(user, input, error instanceof AppError ? error.code : "UNCONFIRMED", req); }));
        throw error;
      }
    });
  }
  private audit(user: OpsUser, input: OpsAction, result: string, req: PayloadRequest) {
    return appendOpsAudit(this.runtime.store.payload, { actorId: user.id, babyId: input.babyId, action: `ops.${input.command.type}`, reason: input.reason, result,
      target: { requestId: input.requestId, ...(input.command.type === "record" ? { tool: input.command.tool } : {}) } }, req);
  }
  private async identityAction(principal: Principal, input: OpsAction): Promise<unknown> {
    const command = input.command, identity = this.runtime.identity;
    if (command.type === "invite") return identity.invite(principal, input.babyId, command.access);
    if (command.type === "grant") return identity.setGrant(principal, input.babyId, command.subjectId, command.state, command.permissions);
    if (command.type === "binding") return identity.bindGroup(principal, input.babyId, command.groupId, command.agentId, command.active);
    if (command.type === "credential") return identity.issueAgent(principal, input.babyId, "collector", command);
    if (command.type === "collector") return this.runtime.collector.dispatch(principal, { ...command.input, babyId: input.babyId, ...(command.input.action === "backfill" ? { requestId: input.requestId } : {}) });
    return fail(400, "OPS_ACTION_INVALID", "不支持此操作。");
  }
  async read(raw: OpsUser, input: OpsRead): Promise<unknown> {
    const user = await this.user(raw, input.babyId, true); // Auditor sees metadata only, never private source/image bodies.
    return this.withPrincipal(user, input.babyId, false, async principal => {
      // Commit the access intent before disclosing sensitive content, including failed lookups.
      await this.runtime.identity.exclusive(() => this.runtime.store.transaction(req => appendOpsAudit(this.runtime.store.payload, { actorId: user.id, babyId: input.babyId, action: `ops.read.${input.kind}`, reason: input.reason, target: { id: input.id } }, req)));
      if (input.kind === "history") {
        const snapshots = [input.before, ...(input.after === undefined ? [] : [input.after])].map(parseHistorySnapshot);
        for (const snapshot of snapshots) if ([...snapshot.activities, ...(snapshot.dailyStats || [])].some(row => row.babyId !== input.babyId)) return fail(403, "OPS_HISTORY_SCOPE", "核对文件含有其他宝宝的数据。");
        return auditHistory(snapshots[0], snapshots[1]);
      }
      if (!input.id) return fail(400, "OPS_RESOURCE_REQUIRED", "请选择需要核对的记录。");
      if (input.kind === "attachment") return this.runtime.attachments.read(principal, input.babyId, input.id);
      const result = input.kind === "event" ? await this.runtime.records.query(principal, { babyId: input.babyId, eventId: input.id, includeRetracted: true })
        : input.kind === "revisions" ? await this.runtime.records.revisions(principal, input.babyId, input.id)
          : await this.runtime.identity.executeAuthorized(principal, input.babyId, "records:read", async (_scope, req) => {
            const message = await this.repo.get("care-messages", input.babyId, input.id!, req);
            if (!message) return fail(404, "SOURCE_NOT_FOUND", "未找到此宝宝的来源消息。"); return message;
          });
      return redactOperations(protectRecordPhotos(result, input.babyId));
    });
  }
  async upload(raw: OpsUser, babyId: string, reason: string, requestId: string, bytes: Uint8Array, mime: string) {
    const user = await this.user(raw, babyId, true);
    return this.withPrincipal(user, babyId, true, principal => this.runtime.identity.exclusive(async () => {
      const result = await this.runtime.attachments.upload(principal, babyId, bytes, mime, requestId);
      await this.runtime.store.transaction(req => appendOpsAudit(this.runtime.store.payload, { actorId: user.id, babyId, action: "ops.attachment.upload", reason, target: { id: result.id, requestId } }, req));
      return { id: result.id, babyId, mime: result.mime, byteLength: result.byteLength };
    }));
  }
}
