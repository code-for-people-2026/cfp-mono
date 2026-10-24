import { z } from "zod";
import { AppError } from "../contracts";
import { readOpsUser, requireBaby, type OpsUser } from "../operations/access";
import { appendOpsAudit } from "../operations/audit";
import type { SafetySignal } from "../safety/service";
import type { DeletionJob, DeletionService } from "./deletion";
import type { PrivacyRequest, PrivacyService } from "./service";
const scope = (user: OpsUser, babyId?: string) => {
  if (user.role === "auditor") throw new AppError(403, "OPS_FORBIDDEN", "隐私请求包含私人内容，需要处理权限。");
  if (babyId) requireBaby(user, babyId, true);
  else if (user.role !== "administrator") throw new AppError(403, "OPS_FORBIDDEN", "账号隐私请求由隐私负责人处理。");
};
const inputSchema = z.object({ action: z.enum(["read", "reply", "review-safety", "retry-deletions"]), reason: z.string().trim().min(4).max(500), babyId: z.string().max(200).optional(), id: z.string().max(200).optional(), expectedUpdatedAt: z.string().optional(), reply: z.string().trim().min(1).max(2000).optional(), status: z.enum(["reviewing", "resolved"]).optional() }).strict();
export class PrivacyOperations {
  constructor(private readonly privacy: PrivacyService, private readonly deletion: DeletionService) {}
  async execute(initial: OpsUser, raw: unknown) {
    const input = inputSchema.parse(raw);
    // Re-read permissions inside the same serialized transaction as the sensitive operation.
    const result = await this.privacy.identity.exclusive(() => this.privacy.identity.store.transaction(async req => {
      const user = await readOpsUser(this.privacy.identity.store.payload, initial, req); scope(user, input.babyId);
      const where = input.babyId ? { babyId: { equals: input.babyId } } : { babyId: { exists: false } };
      const table = input.action === "review-safety" ? "safety-signals" : "privacy-requests";
      if (input.action === "reply" || input.action === "review-safety") {
        if (!input.id || !input.reply) throw new AppError(400, "REPLY_REQUIRED", "请填写处理说明。");
        const previous = await this.privacy.repository.get<PrivacyRequest | SafetySignal>(table, input.id, req);
        if (!previous || previous.babyId !== input.babyId) throw new AppError(404, "REQUEST_NOT_FOUND", "未找到此范围的请求。");
        if (table === "privacy-requests") {
          const request = previous as PrivacyRequest;
          if (request.updatedAt !== input.expectedUpdatedAt) throw new AppError(409, "PRIVACY_REQUEST_CHANGED", "请求已被其他人处理，请刷新。");
          await this.privacy.repository.put(table, input.id, { ...request, reply: input.reply, status: input.status || "resolved", updatedAt: new Date(Math.max(this.privacy.identity.now(), Date.parse(request.updatedAt) + 1)).toISOString() }, { identityId: request.identityId, babyId: request.babyId }, req);
        } else {
          await this.privacy.repository.put(table, input.id, { ...previous, status: "reviewed", note: input.reply }, { babyId: previous.babyId }, req);
        }
      }
      if (input.action === "retry-deletions" && user.role !== "administrator") throw new AppError(403, "OPS_FORBIDDEN", "删除重试需要管理员权限。");
      await appendOpsAudit(this.privacy.identity.store.payload, { actorId: user.id, babyId: input.babyId, action: `privacy.${input.action}`, reason: input.reason, target: { id: input.id, status: input.status } }, req);
      const requests = (await this.privacy.repository.list<PrivacyRequest>("privacy-requests", where, req)).map(row => ({ ...row.value, identityId: undefined }));
      const signals = input.babyId ? (await this.privacy.repository.list<SafetySignal>("safety-signals", where, req)).map(row => row.value) : [];
      const jobs = user.role === "administrator" ? (await this.privacy.repository.list<DeletionJob>("privacy-state", { key: { like: "deletion:" } }, req)).filter(row => row.key.startsWith("deletion:")).map(row => ({ id: row.value.jobId, kind: row.value.kind, status: row.value.status, updatedAt: row.value.updatedAt, errorCode: row.value.errorCode })) : [];
      const maintenance = user.role === "administrator" ? await this.privacy.repository.get<{ at: string; failed?: boolean; report?: { deferredTasks?: number } }>("privacy-state", "maintenance:last", req) : undefined;
      return { requests, signals, jobs, maintenance: maintenance || null };
    }));
    if (input.action === "retry-deletions") await this.deletion.processPending();
    return result;
  }
}
