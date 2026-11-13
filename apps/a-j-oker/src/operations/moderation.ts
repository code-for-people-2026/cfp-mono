import { reservePlatformCalls } from "../cms/platform-quota";
import type { Repository } from "../cms/repository";
import { AppError, ContentReviewError, ContentPendingReviewError } from "../domain/contracts";
import { evaluateText, type Moderator } from "../domain/moderation";
import { activeRule } from "./policy";
import { audit } from "./audit";
import { OperationsService, transaction } from "./service";
import { assertReviewWrite } from "./review-write";
import { reviewCaseAdmission } from "./review-case-admission";

export function operationalModerator(repo: Repository): Moderator {
  return async (request) => {
    const rule = await activeRule(repo.payload).catch(() => { throw new ContentReviewError(503, "内容审核规则暂不可用，请稍后重试"); });
    const verdict = await evaluateText(request, rule, request.mode === "byok" ? undefined : () => reservePlatformCalls(repo.payload, 1));
    const unavailable = () => new ContentReviewError(503, "内容审核暂未完成，请检查调用配置或稍后重试");
    if (verdict.decision === "unavailable" && verdict.failure !== "provider") throw unavailable();
    const recorded = await transaction(repo.payload, async (req) => {
      await assertReviewWrite(repo.owner.id, req);
      let recordedCase: { id: number; receipt: string } | undefined;
      if (verdict.decision !== "allow" && verdict.decision !== "not_reviewed") {
        const admission = await reviewCaseAdmission(repo.owner.id, request, verdict.decision, req);
        if (admission !== "create") return admission;
        const row = await new OperationsService(repo.payload).createCase({
          owner: repo.owner.id, source: "moderation", stage: request.stage, category: verdict.category,
          severity: verdict.category === "self_harm" || verdict.category === "violence" ? "high" : "normal",
          sessionId: request.sessionId, turnId: request.turnId, requestId: request.requestId,
          decision: verdict.decision, ruleVersion: rule.version, lexiconVersion: rule.lexiconVersion, modelVersion: verdict.model,
        }, request.texts.join("\n"), req);
        recordedCase = { id: row.id, receipt: row.receipt };
      }
      await audit(repo.payload, "system:moderation", `moderation.${verdict.decision}`, request.requestId, "自动审核执行记录", { stage: request.stage, rule: rule.version, lexicon: rule.lexiconVersion, model: verdict.model, keywordCount: verdict.keywordCount, serviceScope: verdict.serviceScope }, req);
      return recordedCase;
    }).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      // A content verdict still rejects when its optional case cannot persist.
      // Privacy/lease errors above retain their original status and meaning.
      if (verdict.decision === "block") return "unrecorded";
      if (verdict.decision !== "unavailable" && verdict.decision !== "uncertain") throw error;
      throw unavailable();
    });
    if (verdict.decision === "unavailable" || verdict.decision === "uncertain") {
      if (recorded === "duplicate") {
        if (verdict.decision === "uncertain") throw new ContentPendingReviewError("这条内容需要人工复核，同一请求已有审核记录，可通过投诉与申诉入口查看或补充说明");
        throw new ContentReviewError(503, "内容审核暂未完成，同一请求已有审核记录，请稍后重试");
      }
      if (!recorded || typeof recorded !== "object") throw unavailable();
      // The SQLite adapter can hide a failed COMMIT. Only promise a queued case
      // after observing its committed row outside the transaction.
      const visible = await repo.payload.count({ collection: "safety-cases", overrideAccess: true, where: { and: [
        { id: { equals: recorded.id } }, { receipt: { equals: recorded.receipt } }, { owner: { equals: repo.owner.id } },
      ] } }).catch(() => ({ totalDocs: 0 }));
      if (!visible.totalDocs) throw unavailable();
      if (verdict.decision === "uncertain") throw new ContentPendingReviewError("这条内容需要人工复核，已记录待复核事项，暂未放行；可通过投诉与申诉入口查看或补充说明");
      throw new ContentReviewError(503, "内容审核暂未完成，已记录待复核事项，请稍后重试");
    }
    if (verdict.decision === "block") throw new ContentReviewError(422, request.stage === "input"
      ? "这条请求未通过内容审核，可通过投诉与申诉入口申请复核"
      : "这次回应未通过内容审核，可通过投诉与申诉入口申请复核");
    if (verdict.serviceScope) return { serviceScope: verdict.serviceScope };
  };
}
