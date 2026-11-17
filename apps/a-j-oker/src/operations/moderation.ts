import { reservePlatformCalls } from "../cms/platform-quota";
import type { Repository } from "../cms/repository";
import { AppError, ContentReviewError, ContentPendingReviewError, ServiceProblemError } from "../domain/contracts";
import { evaluateText, ModerationPendingReviewError, ModerationRejectionError, type Moderator } from "../domain/moderation";
import { activeRule } from "./policy";
import { audit } from "./audit";
import { OperationsService, transaction } from "./service";
import { assertReviewWrite } from "./review-write";
import { reviewCaseAdmission } from "./review-case-admission";

type ModerationRequest = Parameters<Moderator>[0];

function contentError(status: 409 | 422, message: string, code: "CONTENT_BLOCKED" | "CONTENT_REVIEW_PENDING") {
  return code === "CONTENT_REVIEW_PENDING"
    ? new ContentPendingReviewError(message, { code, retryable: false, definitive: true })
    : new ContentReviewError(status, message, { code, retryable: false, definitive: true });
}

function retryableTechnicalFailure(
  failure: "configuration" | "admission" | "caller" | "provider",
  reason: string,
) {
  if (failure === "provider") return reason !== "cancelled";
  return reason === "quota_exhausted" || reason === "quota_unavailable" || reason === "provider_quota";
}

function serviceProblemError(request: ModerationRequest, retryable: boolean): ServiceProblemError {
  const beforeGeneration = request.stage === "input" && request.turnId === undefined;
  return new ServiceProblemError(
    503,
    beforeGeneration
      ? "服务暂时不可用，本次尚未开始生成；稍后可用原输入重试，同一请求不会重复保存。"
      : "服务暂时不可用，本次结果尚未确认；请先确认本轮状态，不要直接重复生成。",
    {
      code: "SERVICE_PROBLEM",
      retryable,
      definitive: beforeGeneration,
    },
  );
}

async function recordTechnicalFailure(
  repo: Repository,
  request: ModerationRequest,
  diagnostic: Record<string, unknown>,
) {
  // The local structured event is guaranteed. The existing safety-audit is an
  // operations record with safe metadata and no evidence or user content.
  console.info(JSON.stringify({
    event: "hello_moderation_service_failure",
    ...diagnostic,
  }));
  await audit(
    repo.payload,
    "system:moderation",
    "moderation.service_failed",
    request.requestId,
    "技术失败诊断；不创建内容审核案件",
    diagnostic,
  ).catch(() => {
    console.warn(JSON.stringify({
      event: "hello_moderation_service_failure_audit_unavailable",
      stage: request.stage,
      requestId: request.requestId,
    }));
  });
}

function fallbackDiagnostic(request: ModerationRequest, model: string, reason: string) {
  return {
    version: 1,
    requestId: request.requestId,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    stage: request.stage,
    model,
    durationMs: 0,
    phase: "configuration",
    reason,
    keywordCount: 0,
  };
}

export function operationalModerator(repo: Repository): Moderator {
  return async (request) => {
    const rule = await activeRule(repo.payload).catch(async () => {
      await recordTechnicalFailure(repo, request, fallbackDiagnostic(request, "unavailable", "review_policy_unavailable"));
      throw serviceProblemError(request, true);
    });
    const verdict = await evaluateText(request, rule, request.mode === "byok" ? undefined : () => reservePlatformCalls(repo.payload, 1));
    const unavailable = () => serviceProblemError(
      request,
      retryableTechnicalFailure(verdict.failure ?? "provider", verdict.diagnostic?.reason ?? "provider_request_failed"),
    );
    const semanticVerdict = {
      ...(verdict.serviceScope ? { serviceScope: verdict.serviceScope } : {}),
      ...(verdict.interaction ? { interaction: verdict.interaction } : {}),
    };
    const rejection = (error: ContentReviewError) => error instanceof ContentPendingReviewError
      ? new ModerationPendingReviewError(error, semanticVerdict)
      : new ModerationRejectionError(error, semanticVerdict);
    if (verdict.decision === "unavailable") {
      await recordTechnicalFailure(repo, request, {
        ...(verdict.diagnostic ?? fallbackDiagnostic(request, verdict.model, "unknown")),
      });
      throw unavailable();
    }
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
      await audit(repo.payload, "system:moderation", `moderation.${verdict.decision}`, request.requestId, "自动审核执行记录", { stage: request.stage, rule: rule.version, lexicon: rule.lexiconVersion, model: verdict.model, keywordCount: verdict.keywordCount, serviceScope: verdict.serviceScope, interaction: verdict.interaction }, req);
      return recordedCase;
    }).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      // A content verdict still rejects when its optional case cannot persist.
      // Privacy/lease errors above retain their original status and meaning.
      if (verdict.decision === "block") return "unrecorded";
      if (verdict.decision !== "uncertain") throw error;
      throw unavailable();
    });
    if (verdict.decision === "uncertain") {
      if (recorded === "duplicate") {
        throw rejection(contentError(409, "这条内容需要人工复核，同一请求已有审核记录，可通过投诉与申诉入口查看或补充说明", "CONTENT_REVIEW_PENDING"));
      }
      if (!recorded || typeof recorded !== "object") throw unavailable();
      // The SQLite adapter can hide a failed COMMIT. Only promise a queued case
      // after observing its committed row outside the transaction.
      const visible = await repo.payload.count({ collection: "safety-cases", overrideAccess: true, where: { and: [
        { id: { equals: recorded.id } }, { receipt: { equals: recorded.receipt } }, { owner: { equals: repo.owner.id } },
      ] } }).catch(() => ({ totalDocs: 0 }));
      if (!visible.totalDocs) throw unavailable();
      throw rejection(contentError(409, "这条内容需要人工复核，已记录待复核事项，暂未放行；可通过投诉与申诉入口查看或补充说明", "CONTENT_REVIEW_PENDING"));
    }
    if (verdict.decision === "block") throw rejection(new ContentReviewError(422, request.stage === "input"
      ? "这条请求未通过内容审核，可通过投诉与申诉入口申请复核"
      : "这次回应未通过内容审核，可通过投诉与申诉入口申请复核", { code: "CONTENT_BLOCKED", retryable: false, definitive: true }));
    if (verdict.serviceScope || verdict.interaction) return { ...(verdict.serviceScope ? { serviceScope: verdict.serviceScope } : {}), ...(verdict.interaction ? { interaction: verdict.interaction } : {}) };
  };
}
