import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PayloadRequest, Where } from "payload";
import { AppError } from "../contracts";
import type { Principal } from "../identity";
import type { AttachmentService } from "../records/attachments";
import { recordTables } from "../records/persistence";
import type { PrivacyService, GuardianConsent } from "./service";
import { DeletionLedger, type DeletionEntry } from "./deletion-ledger";

export interface DeletionJob extends DeletionEntry { status: "pending" | "running" | "retry" | "completed"; updatedAt: string; errorCode?: string }
interface Intent { contractVersion: 2; legacyUserIds: string[]; kind: "account" | "family"; identityId: string; babyId?: string; expiresAt: string; used?: string; confirmation: string }
export interface FamilyLifecycle {
  exportFamilyData(babyId: string): Promise<unknown>;
  deleteFamilyData(babyId: string): Promise<void>;
}
export interface AccountLifecycle {
  exportAccountData(userId: string): Promise<unknown>;
  deleteAccountData(userId: string): Promise<void>;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const fail = (code: string, message: string, status = 403): never => { throw new AppError(status, code, message); };

/** Durable rights requests; destructive execution only follows an exact, recent, owner-confirmed intent. */
export class DeletionService {
  private running?: Promise<void>;
  constructor(readonly privacy: PrivacyService, readonly attachments: AttachmentService, readonly ledger: DeletionLedger, private readonly legacy?: FamilyLifecycle, private readonly accounts?: AccountLifecycle) {}
  private get identity() { return this.privacy.identity; }
  private now() { return new Date(this.identity.now()).toISOString(); }
  private async owner(principal: Principal, babyId?: string) {
    await this.identity.privacyIdentity(principal);
    if (!babyId) return;
    await this.identity.authorizeForPrivacy(principal, babyId, "baby:manage");
    const guardian = await this.privacy.repository.get<GuardianConsent>("privacy-state", `guardian:${babyId}`);
    // Withdrawal never removes the owner's ability to delete their family's data.
    if (!guardian || !(await this.identity.accountIdentityIds(principal.subjectId)).includes(guardian.identityId)) fail("GUARDIAN_REQUIRED", "只有已声明并获授权的监护人可以删除整个家庭的宝宝数据。");
  }
  async prepare(principal: Principal, kind: "account" | "family", babyId?: string) {
    if ((kind === "family") !== !!babyId) fail("INVALID_DELETION_SCOPE", "请选择明确的删除范围。", 400);
    await this.owner(principal, babyId);
    const token = randomBytes(32).toString("base64url"), expiresAt = new Date(this.identity.now() + 10 * 60_000).toISOString();
    const legacyUserIds = kind === "account" ? await this.identity.accountLegacyUserIds(principal.subjectId) : [];
    const confirmation = kind === "family" ? "删除宝宝全部数据" : legacyUserIds.length ? "注销我的账号和已绑定原版账号" : "注销我的账号";
    await this.identity.exclusive(() => this.privacy.repository.put("privacy-state", `intent:${digest(token)}`, { contractVersion: 2, legacyUserIds, kind, identityId: principal.subjectId, babyId, expiresAt, confirmation } satisfies Intent, { identityId: principal.subjectId, babyId }));
    return { token, expiresAt, confirmation, scope: kind, consequences: kind === "family"
      ? ["删除宝宝资料、全部照护记录、来源、修订、照片及家庭相关对话。", "所有照护者和采集 Agent 立即停止访问；此操作不能通过恢复备份撤销。"]
      : ["删除本人的登录身份、私人对话和未关联家庭记录的照片，退出所有设备与 Agent。", `已绑定的 ${legacyUserIds.length} 个原版账号的本人资料、密码、登录凭证及家庭授权关系一并删除；其他人的家庭记录和必要照护来源保留。`, "若本人是授权监护人，家庭处理会暂停，直到拥有管理权限的其他成年监护人重新声明授权；如要删除宝宝全部数据，请另外选择家庭数据删除。"] };
  }
  async confirm(principal: Principal, token: string, confirmation: string): Promise<{ id: string; status: DeletionJob["status"] }> {
    await this.identity.privacyIdentity(principal);
    return this.identity.exclusive(async () => {
      const intent = await this.privacy.repository.get<Intent>("privacy-state", `intent:${digest(token)}`);
      if (!intent || intent.identityId !== principal.subjectId) fail("DELETION_INTENT_INVALID", "删除确认已失效，请重新查看删除范围。", 400);
      if (intent!.contractVersion !== 2) fail("DELETION_SCOPE_CHANGED", "注销范围已更新，请重新阅读并确认。", 409);
      if (intent!.used) {
        const previous = await this.privacy.repository.get<DeletionJob>("privacy-state", `deletion:${intent!.used}`);
        if (previous) return { id: previous.jobId, status: previous.status };
      }
      if (Date.parse(intent!.expiresAt) <= this.identity.now() || confirmation !== intent!.confirmation) fail("DELETION_CONFIRMATION_REQUIRED", "请在确认有效期内输入完整的确认文字。", 400);
      const session = await this.identity.store.get("sessions", principal.sessionId);
      if (!session?.createdAt || Date.parse(session.createdAt) < this.identity.now() - 15 * 60_000) fail("REAUTHENTICATION_REQUIRED", "为保护数据，请重新微信登录后再确认删除。", 401);
      await this.owner(principal, intent!.babyId);
      const legacyUserIds = intent!.kind === "account" ? await this.identity.accountLegacyUserIds(principal.subjectId) : [];
      if (JSON.stringify(legacyUserIds) !== JSON.stringify(intent!.legacyUserIds)) fail("DELETION_SCOPE_CHANGED", "已绑定账号发生变化，请重新阅读并确认注销范围。", 409);
      const entry: DeletionEntry = { version: 1, jobId: randomUUID(), kind: intent!.kind, identityId: principal.subjectId, ...(intent!.babyId ? { babyId: intent!.babyId } : { identityIds: await this.identity.accountIdentityIds(principal.subjectId), legacyUserIds }), createdAt: this.now() };
      // Durable ledger is outside the transaction. If the DB commit fails, replay still freezes this scope.
      this.ledger.append(entry);
      const job: DeletionJob = { ...entry, status: "pending", updatedAt: this.now() };
      await this.privacy.repository.put("privacy-state", `deletion:${job.jobId}`, job, { identityId: principal.subjectId });
      await this.privacy.repository.put("privacy-state", `intent:${digest(token)}`, { ...intent!, used: job.jobId }, { identityId: principal.subjectId, babyId: intent!.babyId });
      return { id: job.jobId, status: job.status };
    });
  }
  async jobs(principal: Principal) {
    await this.identity.privacyIdentity(principal);
    const rows = await this.privacy.repository.list<DeletionJob>("privacy-state", { and: [{ identityId: { equals: principal.subjectId } }, { key: { like: "deletion:" } }] });
    return rows.filter(row => row.key.startsWith("deletion:")).map(row => ({ id: row.value.jobId, scope: row.value.kind, status: row.value.status, updatedAt: row.value.updatedAt, errorCode: row.value.errorCode }));
  }
  async export(principal: Principal, babyId?: string) {
    await this.owner(principal, babyId);
    return this.identity.exclusive(async () => {
      const payload = this.identity.store.payload, req = this.identity.store.currentRequest();
      const identityIds = await this.identity.accountIdentityIds(principal.subjectId);
      const where: Where = babyId ? { babyId: { equals: babyId } } : { identityId: { in: identityIds } };
      const chats = await payload.find({ collection: "chat-turns", where: { and: [where, { identityId: { in: identityIds } }] }, pagination: true, limit: 10001, depth: 0, overrideAccess: true, req });
      if (chats.totalDocs > 10000) fail("EXPORT_TOO_LARGE", "记录较多，请联系隐私渠道分批导出。", 413);
      const ownChats = chats.docs.map(row => {
        const value = row.value as Record<string, unknown>;
        return { createdAt: value.createdAt, input: value.input, assistantText: value.assistantText, aiLabel: value.replySource === "safety" ? "系统安全提示" : "助手回复由 AI 生成", status: value.status };
      });
      const family = babyId ? await this.legacy?.exportFamilyData(babyId) : undefined;
      if (babyId && family === undefined) fail("LEGACY_EXPORT_UNAVAILABLE", "原照护数据导出尚未配置，请联系隐私渠道处理。", 503);
      const account: unknown[] = [];
      if (!babyId) for (const userId of await this.identity.accountLegacyUserIds(principal.subjectId)) {
        if (!this.accounts) fail("LEGACY_ACCOUNT_EXPORT_UNAVAILABLE", "本人原账号资料导出尚未配置，请联系隐私渠道。", 503);
        account.push(await this.accounts!.exportAccountData(userId));
      }
      const value = { format: "bubu-privacy-export-v1", ...(!babyId ? { account } : {}), exportedAt: this.now(), scope: babyId ? "family" : "account", privateChat: ownChats, ...(family ? { family } : {}), notice: "账号导出含本人非秘密资料、账号关联和私人对话；不包含密码或访问令牌。家庭记录属于共享照护数据。用户原文与事实并非 AI 生成。附件通过已鉴权的图片接口另行保存。" };
      if (Buffer.byteLength(JSON.stringify(value)) > 10 * 1024 * 1024) fail("EXPORT_TOO_LARGE", "导出超过单次大小限制，请联系隐私渠道分批处理。", 413);
      return value;
    });
  }
  async processPending(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async remove(collection: string, where: Where, req: PayloadRequest) {
    const result = await this.identity.store.payload.delete({ collection, where, overrideAccess: true, req });
    if (result.errors?.length) throw new Error("Deletion did not remove every scoped document");
  }
  private async run() {
    for (const entry of this.ledger.read()) {
      const key = `deletion:${entry.jobId}`;
      const previous = await this.privacy.repository.get<DeletionJob>("privacy-state", key);
      if (previous?.status === "completed") continue;
      try {
        await this.identity.exclusive(() => this.privacy.repository.put("privacy-state", key, { ...entry, status: "running", updatedAt: this.now() } satisfies DeletionJob, { identityId: entry.identityId }));
        if (entry.kind === "family") {
          if (!this.legacy) fail("LEGACY_DELETION_UNAVAILABLE", "原照护数据删除尚未配置。", 503);
          await this.legacy!.deleteFamilyData(entry.babyId!);
        }
        if (entry.kind === "account" && entry.legacyUserIds?.length) {
          if (!this.accounts) fail("LEGACY_ACCOUNT_DELETION_UNAVAILABLE", "原账号资料删除尚未配置。", 503);
          for (const userId of entry.legacyUserIds) await this.accounts!.deleteAccountData(userId);
        }
        await this.identity.exclusive(() => this.identity.store.transaction(async req => {
          req.context.bubuPrivacyDeletion = true;
          const store = this.identity.store, payload = store.payload;
          const identityIds = entry.identityIds || [entry.identityId];
          const scoped: Where = entry.kind === "family" ? { babyId: { equals: entry.babyId } } : { identityId: { in: identityIds } };
          await this.remove("chat-turns", scoped, req);
          if (entry.kind === "family") {
            for (const collection of [...recordTables, "service-memberships", "service-membership-changes", "ops-requests", "safety-signals"]) {
              if (payload.collections[collection]) await this.remove(collection, { babyId: { equals: entry.babyId } }, req);
            }
            await this.attachments.purgeFamilyObjects(entry.babyId!);
          } else {
            const rows = await payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
            for (const row of rows.docs) {
              const attachment = row.value as { uploadedBy?: { id?: string; onBehalfOf?: string }; babyId: string; id: string };
              if (![attachment.uploadedBy?.id, attachment.uploadedBy?.onBehalfOf].some(id => !!id && identityIds.includes(id))) continue;
              // Shared record/revision references remain part of the family's care history.
              let shared = false;
              for (const collection of ["care-events", "care-revisions", "care-operations", "care-messages"]) {
                const refs = await payload.find({ collection, where: { babyId: { equals: attachment.babyId } }, pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
                if (refs.docs.some(ref => JSON.stringify(ref.value).includes(attachment.id))) { shared = true; break; }
              }
              if (!shared) await payload.delete({ collection: "care-attachments", id: row.id, overrideAccess: true, req });
            }
          }
          const accountSessions = new Set((await store.list("sessions")).filter(row => identityIds.includes(String(row.value.subjectId))).map(row => row.key));
          for (const collection of ["sessions", "grants", "invitations", "group-bindings", "audit"] as const) {
            for (const row of await store.list(collection)) {
              const matches = entry.kind === "family" ? row.value.babyId === entry.babyId : [row.value.subjectId, row.value.actorId, row.value.identityId, row.value.createdBy, row.value.acceptedBy].some(id => identityIds.includes(String(id))) || entry.kind === "account" && collection === "sessions" && accountSessions.has(String(row.value.parentSessionId));
              if (matches) await payload.delete({ collection, id: row.id, overrideAccess: true, req });
            }
          }
          if (entry.kind === "account") for (const row of await store.list("identities")) if (identityIds.includes(String(row.value.subjectId)) || identityIds.some(id => row.key === `subject:${id}` || row.key === `family:${id}`)) await payload.delete({ collection: "identities", id: row.id, overrideAccess: true, req });
          await this.remove("privacy-requests", scoped, req);
          for (const row of await this.privacy.repository.list("privacy-state", scoped, req)) if (!row.key.startsWith("deletion:")) await payload.delete({ collection: "privacy-state", id: row.id, overrideAccess: true, req });
          if (entry.kind === "family") for (const row of await store.list("identities")) {
            if (row.key.startsWith("family:") && row.value.babyId === entry.babyId) await payload.delete({ collection: "identities", id: row.id, overrideAccess: true, req });
            else if (row.key.startsWith("subject:") && row.value.currentBabyId === entry.babyId) { const value = { ...row.value }; delete value.currentBabyId; await store.put("identities", row.key, value); }
          }
          await this.attachments.purgeOrphanObjects(req);
          await this.privacy.repository.put("privacy-state", key, { ...entry, status: "completed", updatedAt: this.now() } satisfies DeletionJob, { identityId: entry.identityId }, req);
        }));
      } catch (error) {
        await this.identity.exclusive(() => this.privacy.repository.put("privacy-state", key, { ...entry, status: "retry", updatedAt: this.now(), errorCode: error instanceof AppError ? error.code : "DELETION_RETRY_REQUIRED" } satisfies DeletionJob, { identityId: entry.identityId }));
      }
    }
  }
  /** Offline restore/migration: only a completed ledger-backed family deletion supersedes older media receipts. */
  async hasCompletedFamilyDeletion(babyId: string) {
    const entries = this.ledger.read().filter(entry => entry.kind === "family" && entry.babyId === babyId);
    if (!entries.length) return false;
    for (const entry of entries) if ((await this.privacy.repository.get<DeletionJob>("privacy-state", `deletion:${entry.jobId}`))?.status !== "completed") return false;
    return true;
  }
  /** Restored snapshots must replay even jobs that appeared completed in the restored DB. */
  async replayAfterRestore() {
    for (const entry of this.ledger.read()) await this.identity.exclusive(() => this.privacy.repository.put("privacy-state", `deletion:${entry.jobId}`, { ...entry, status: "pending", updatedAt: this.now() } satisfies DeletionJob, { identityId: entry.identityId }));
    await this.processPending();
    for (const entry of this.ledger.read()) if ((await this.privacy.repository.get<DeletionJob>("privacy-state", `deletion:${entry.jobId}`))?.status !== "completed") throw new Error("Restored data remains frozen: deletion replay is incomplete");
  }
}
