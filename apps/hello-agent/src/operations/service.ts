import { workingDeadline, COMPLAINT_SLA } from "./deadlines";
import type { SafetyCase, Greeting } from "../payload-types";
import { createHash, randomUUID } from "node:crypto";
import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Payload, type PayloadRequest, type TypedUser, type Where } from "payload";
import { z } from "zod";
import { AppError, type Owner } from "../domain/contracts";
import { audit } from "./audit";
import { canReview, categories, isAdministrator, settings, settingSchema } from "./policy";

type Doc = SafetyCase;
type CaseInput = Pick<SafetyCase, "owner" | "source" | "category" | "stage"> & Partial<Pick<SafetyCase, "severity" | "sessionId" | "turnId" | "mediaId" | "requestId" | "parentId" | "modelVersion" | "ruleVersion" | "lexiconVersion" | "decision">>;
const complaintSchema = z.object({
  kind: z.enum(["complaint", "appeal"]).default("complaint"), category: z.enum(categories),
  description: z.string().trim().min(5).max(1200), turnId: z.number().int().positive().optional(),
  parentReceipt: z.string().uuid().optional(),
}).strict();
const actionSchema = z.object({
  revision: z.number().int().nonnegative(), action: z.enum(["claim", "review", "reject", "dismiss", "quarantine", "restore", "restrict", "unrestrict", "feedback", "hold", "release_hold"]),
  reason: z.string().trim().min(8).max(1000), reply: z.string().trim().min(5).max(1000).optional(),
  severity: z.enum(["urgent", "high", "normal"]).optional(),
  category: z.enum(categories).optional(),
}).strict();
// SQLite's local adapter shares a connection. Do not overlap transaction lifetimes
// on that connection; the database lease still coordinates separate processes.
const transactionQueues = new WeakMap<Payload, Promise<void>>();
export async function transaction<T>(payload: Payload, action: (req: PayloadRequest) => Promise<T>) {
  const previous = transactionQueues.get(payload) || Promise.resolve();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  transactionQueues.set(payload, waiting);
  await previous;
  try {
    const req = await createLocalReq({ context: { safetyInternal: true } }, payload);
    if (!await initTransaction(req)) throw new Error("Safety operations require a database transaction");
    try { const result = await action(req); await commitTransaction(req); return result; }
    catch (error) { await killTransaction(req); throw error; }
  } finally {
    release();
    if (transactionQueues.get(payload) === waiting) transactionQueues.delete(payload);
  }
}
const safePublic = (doc: Doc) => ({
  receipt: doc.receipt, kind: doc.source, status: doc.status, createdAt: doc.createdAt,
  acceptedAt: doc.acceptedAt, acceptBy: doc.acceptBy, resolveBy: doc.resolveBy, feedbackBy: doc.feedbackBy,
  reply: doc.feedbackAt ? doc.reply : undefined, feedbackAt: doc.feedbackAt,
  canAppeal: doc.status === "resolved", turnId: doc.turnId,
});
export class OperationsService {
  constructor(readonly payload: Payload) {}
  async configuration() {
    const config = await settings(this.payload);
    return config ? { notice: COMPLAINT_SLA, configured: true, acceptanceHours: config.acceptanceHours, resolutionHours: config.resolutionHours, feedbackHours: config.feedbackHours, evidenceDays: config.evidenceDays }
      : { configured: false, notice: COMPLAINT_SLA + "当前后台其他运营参数尚待配置；获取编号不代表已受理。" };
  }
  async createCase(data: CaseInput, evidence: string, req: PayloadRequest) {
    const config = await settings(this.payload, req);
    const now = Date.now();
    const hours = (value: unknown) => config ? new Date(now + Number(value) * 3600_000).toISOString() : undefined;
    const row = await this.payload.create({ collection: "safety-cases", overrideAccess: true, req, data: {
      ...data, receipt: randomUUID(), status: data.source === "appeal" ? "review" : "pending", severity: data.severity || "normal", revision: 0,
      acceptBy: data.severity === "urgent" ? new Date(now).toISOString() : ["complaint", "appeal"].includes(data.source) ? workingDeadline(now, 1) : hours(config?.acceptanceHours),
      resolveBy: ["complaint", "appeal"].includes(data.source) ? workingDeadline(now, 7) : hours(config?.resolutionHours),
      feedbackBy: ["complaint", "appeal"].includes(data.source) ? workingDeadline(now, 7) : undefined,
      ...(data.severity === "urgent" ? { alertStatus: "pending" as const, alertNextAt: new Date(now).toISOString(), alertDetails: { attempts: 0 } } : {}),
      // 0 means no automatic expiry; explicit finite settings and prior cases retain their terms.
      retainUntil: Number(config?.evidenceDays ?? 0) > 0 ? new Date(now + Number(config?.evidenceDays) * 86400_000).toISOString() : null,
      retentionBasis: config?.retentionBasis || "安全证据默认永久保留，不自动到期；仅限受控复核使用，数据权利申请另行处理",
    } });
    await this.payload.create({ collection: "safety-evidence", overrideAccess: true, req, data: {
      caseId: row.id, excerpt: evidence.slice(0, 1200), originalLength: evidence.length,
      digest: createHash("sha256").update(evidence).digest("hex"),
    } });
    await audit(this.payload, String(data.source === "moderation" || data.source === "image" ? "system:moderation" : `owner:${data.owner}`), "case.created", `case:${row.id}`, String(data.source), { stage: data.stage, category: data.category }, req);
    return row;
  }
  async complain(owner: Owner, value: unknown) {
    const input = complaintSchema.parse(value);
    return transaction(this.payload, async (req) => {
      const recent = await this.payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ owner: { equals: owner.id } }, { source: { in: ["complaint", "appeal"] } }, { createdAt: { greater_than: new Date(Date.now() - 86400_000).toISOString() } }] } });
      if (recent.totalDocs >= 10) throw new AppError(429, "今天已提交较多事项，请先查看已有受理结果");
      let parent: Doc | undefined;
      if (input.kind === "appeal") {
        if (!input.parentReceipt) throw new AppError(400, "申诉需要原受理编号");
        parent = (await this.payload.find({ collection: "safety-cases", overrideAccess: true, req, limit: 1, where: { and: [{ receipt: { equals: input.parentReceipt } }, { owner: { equals: owner.id } }] } })).docs[0];
        if (!parent) throw new AppError(404, "受理记录不存在");
        if (parent.status !== "resolved") throw new AppError(409, "原事项尚未处置，请等待结果");
        const duplicate = await this.payload.count({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ parentId: { equals: parent.id } }, { status: { not_equals: "resolved" } }] } });
        if (duplicate.totalDocs) throw new AppError(409, "已有申诉正在复核");
      } else if (input.parentReceipt) throw new AppError(400, "举报不能指定申诉编号");
      const turnId = parent?.turnId ?? input.turnId;
      let turn: Greeting | undefined;
      if (turnId) {
        turn = (await this.payload.find({ collection: "greetings", overrideAccess: true, req, limit: 1, where: { and: [{ id: { equals: turnId } }, { owner: { equals: owner.id } }] } })).docs[0];
        if (!turn) throw new AppError(404, "关联轮次不存在或不属于本人");
      }
      const lastReview = turn?.requestKey ? (await this.payload.find({ collection: "safety-audit", overrideAccess: true, req, limit: 1, sort: "-id", where: { and: [{ target: { equals: turn.requestKey } }, { event: { like: "moderation." } }] } })).docs[0]?.metadata as Record<string, unknown> | undefined : undefined;
      const row = await this.createCase({ owner: owner.id, source: input.kind, category: input.category, stage: parent?.stage || "user_report", parentId: parent?.id, turnId, sessionId: turn?.sessionId ?? parent?.sessionId, mediaId: parent?.mediaId, modelVersion: parent?.modelVersion || (typeof lastReview?.model === "string" ? lastReview.model : undefined) || turn?.model || "未记录", ruleVersion: parent?.ruleVersion || (typeof lastReview?.rule === "string" ? lastReview.rule : undefined) || "历史轮次未记录", lexiconVersion: parent?.lexiconVersion || (typeof lastReview?.lexicon === "string" ? lastReview.lexicon : undefined) || "历史轮次未记录" }, turn ? `举报说明：${input.description.slice(0, 550)}\n关联回应最小片段：${String(turn.greeting || turn.error || "尚无回应").slice(0, 550)}` : input.description, req);
      return safePublic(row);
    });
  }
  async mine(owner: Owner, receipt?: string) {
    const result = await this.payload.find({ collection: "safety-cases", overrideAccess: true, limit: 100, sort: "-id", where: { and: [{ owner: { equals: owner.id } }, ...(receipt ? [{ receipt: { equals: receipt } }] : [])] } });
    if (receipt && !result.docs.length) throw new AppError(404, "受理记录不存在");
    return result.docs.map((doc) => safePublic(doc));
  }
  async queue(user: TypedUser, query: { status?: string; severity?: string; mine?: boolean; overdue?: boolean }) {
    if (!canReview(user)) throw new AppError(403, "需要审核权限");
    const clauses: Where[] = [];
    if (query.status) clauses.push({ status: { equals: query.status } });
    if (query.severity) clauses.push({ severity: { equals: query.severity } });
    if (query.mine) clauses.push({ assignedTo: { equals: user.id } });
    if (query.overdue) { const now = new Date().toISOString(); clauses.push({ or: [
      { and: [{ acceptedAt: { exists: false } }, { acceptBy: { less_than: now } }] },
      { and: [{ status: { not_equals: "resolved" } }, { resolveBy: { less_than: now } }] },
      { and: [{ feedbackAt: { exists: false } }, { feedbackBy: { less_than: now } }] },
    ] }); }
    return (await this.payload.find({ collection: "safety-cases", user, overrideAccess: false, limit: 100, sort: "-id", where: { and: clauses }, depth: 0 })).docs;
  }
  async evidence(user: TypedUser, id: number, reason: string) {
    if (!canReview(user)) throw new AppError(403, "需要审核权限");
    z.string().trim().min(8).max(500).parse(reason);
    return transaction(this.payload, async (req) => {
      const row = await this.payload.findByID({ collection: "safety-cases", id, overrideAccess: true, req });
      if (row.assignedTo !== user.id && !isAdministrator(user)) throw new AppError(403, "请先领取案件后按需查看证据");
      const evidence = (await this.payload.find({ collection: "safety-evidence", overrideAccess: true, req, limit: 1, where: { caseId: { equals: id } } })).docs[0];
      await audit(this.payload, `admin:${user.id}`, "evidence.read", `case:${id}`, reason, undefined, req);
      if (!evidence || evidence.purgedAt || (!row.legalHold && row.retainUntil && String(row.retainUntil) < new Date().toISOString())) return { unavailable: true, message: "最小证据已清理或到期" };
      return { excerpt: evidence.excerpt, digest: evidence.digest, originalLength: evidence.originalLength };
    });
  }
  async action(user: TypedUser, id: number, value: unknown) {
    if (!canReview(user)) throw new AppError(403, "需要审核权限");
    const input = actionSchema.parse(value);
    return transaction(this.payload, async (req) => {
      const row = await this.payload.findByID({ collection: "safety-cases", id, overrideAccess: true, req });
      if (row.revision !== input.revision) throw new AppError(409, "案件已被其他人处理，请刷新");
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { revision: input.revision + 1 };
      if (input.action === "claim") {
        if (row.status === "resolved") throw new AppError(409, "已结案事项应通过复核重新受理");
        if (row.assignedTo && row.assignedTo !== user.id && !isAdministrator(user)) throw new AppError(409, "案件已有负责人");
        Object.assign(patch, { assignedTo: user.id, acceptedAt: row.acceptedAt || now, status: row.status === "review" ? "review" : "in_progress", severity: input.severity || row.severity, category: input.category || row.category });
      } else if (["hold", "release_hold"].includes(input.action)) {
        if (!isAdministrator(user)) throw new AppError(403, "留存依据调整需要管理员");
        Object.assign(patch, { legalHold: input.action === "hold", holdReason: input.reason });
      } else if (input.action === "review") {
        if (row.assignedTo !== user.id && !isAdministrator(user)) throw new AppError(403, "请由负责人或管理员转交复核");
        Object.assign(patch, { status: "review", assignedTo: null, resolvedAt: null, feedbackAt: null });
      } else {
        if (row.assignedTo !== user.id) throw new AppError(403, "请由案件负责人操作");
        if (input.action === "feedback") {
          if (row.status !== "resolved" || !input.reply) throw new AppError(409, "处置完成后填写反馈内容");
          Object.assign(patch, { reply: input.reply, feedbackAt: now });
        } else {
          if (!["in_progress", "review"].includes(String(row.status))) throw new AppError(409, "请先受理案件");
          if (row.status === "review" && row.lastReviewer === user.id) throw new AppError(403, "复核须由不同人员完成");
          if (row.parentId) {
            const parent = await this.payload.findByID({ collection: "safety-cases", id: Number(row.parentId), overrideAccess: true, req });
            if (parent.lastReviewer === user.id) throw new AppError(403, "申诉须由原处置人以外的人员复核");
          }
          if (["restrict", "unrestrict"].includes(input.action) && !isAdministrator(user)) throw new AppError(403, "用户生成限制需要管理员");
          if (input.action === "reject") {
            if (row.source !== "moderation" || !["input", "output"].includes(row.stage) || row.mediaId)
              throw new AppError(409, "此动作仅用于尚未生成内容的文本审核请求");
            if (row.turnId) {
              const turn = await this.payload.findByID({ collection: "greetings", id: row.turnId, overrideAccess: true, req });
              // Do not close a running/stored task with a bookkeeping-only action.
              // Existing content and resumable images require quarantine instead.
              if (turn.owner !== row.owner || turn.status !== "failed" || turn.greeting || turn.artifacts?.length || turn.imageGeneration)
                throw new AppError(409, "已有生成内容或未结束的任务，请使用内容隔离处置");
            }
          }
          if (["quarantine", "restore"].includes(input.action) && !row.turnId && !row.mediaId) throw new AppError(400, "此案件没有可处置的已存内容");
          if (["quarantine", "restore", "restrict", "unrestrict"].includes(input.action)) await this.enforce(row, input.action, input.reason, req);
          const config = await settings(this.payload, req);
          Object.assign(patch, { status: "resolved", resolvedAt: now, action: input.action, reason: input.reason, lastReviewer: user.id,
            feedbackBy: ["complaint", "appeal"].includes(row.source) ? row.resolveBy : config ? new Date(Date.now() + Number(config.feedbackHours) * 3600_000).toISOString() : null,
            reply: input.reply || null, feedbackAt: input.reply ? now : null,
          });
        }
      }
      const changed = await this.payload.update({ collection: "safety-cases", overrideAccess: true, req, where: { and: [{ id: { equals: id } }, { revision: { equals: input.revision } }] }, data: patch });
      if (changed.docs.length !== 1 || changed.errors.length) throw new AppError(409, "案件更新冲突，请刷新");
      await audit(this.payload, `admin:${user.id}`, `case.${input.action}`, `case:${id}`, input.reason, { from: row.status, to: patch.status ?? row.status, revision: patch.revision }, req);
      return changed.docs[0];
    });
  }
  private async enforce(row: Doc, action: string, reason: string, req: PayloadRequest) {
    let origin = row;
    while (origin.parentId) origin = await this.payload.findByID({ collection: "safety-cases", id: Number(origin.parentId), overrideAccess: true, req });
    const caseId = origin.id;
    const active = ["quarantine", "restrict"].includes(action);
    const targetType = ["restrict", "unrestrict"].includes(action) ? "owner" : row.turnId ? "turn" : "media";
    const targetId = targetType === "turn" ? row.turnId : targetType === "media" ? row.mediaId : undefined;
    const key = `${targetType}:${targetId || row.owner}:${caseId}`;
    const existing = (await this.payload.find({ collection: "safety-enforcements", overrideAccess: true, req, limit: 1, where: { key: { equals: key } } })).docs[0];
    const data = { key, owner: row.owner, targetType, targetId, sessionId: row.sessionId, caseId, active, reason };
    if (existing) await this.payload.update({ collection: "safety-enforcements", id: existing.id, data, overrideAccess: true, req });
    else if (active) await this.payload.create({ collection: "safety-enforcements", data, overrideAccess: true, req });
    else throw new AppError(409, "原案件没有对应的生效处置；不能解除其他案件的限制");
  }
  async configure(user: TypedUser, value: unknown) {
    if (!isAdministrator(user)) throw new AppError(403, "需要管理员权限");
    const data = settingSchema.parse(value);
    return transaction(this.payload, async (req) => {
      const row = await this.payload.create({ collection: "safety-settings", overrideAccess: true, req, data });
      await audit(this.payload, `admin:${user.id}`, "settings.publish", `settings:${row.id}`, data.reason, undefined, req);
      return row;
    });
  }
}
