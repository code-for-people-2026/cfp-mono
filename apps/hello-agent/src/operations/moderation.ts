import type { Repository } from "../cms/repository";
import { ContentReviewError } from "../domain/contracts";
import { evaluateText, type Moderator } from "../domain/moderation";
import { activeRule } from "./policy";
import { audit } from "./audit";
import { OperationsService, transaction } from "./service";

export function operationalModerator(repo: Repository): Moderator {
  return async (request) => {
    const rule = await activeRule(repo.payload);
    const verdict = await evaluateText(request, rule);
    await transaction(repo.payload, async (req) => {
      if (!["allow", "not_reviewed"].includes(verdict.decision)) {
        await new OperationsService(repo.payload).createCase({
          owner: repo.owner.id, source: "moderation", stage: request.stage, category: verdict.category,
          severity: verdict.category === "self_harm" || verdict.category === "violence" ? "high" : "normal",
          sessionId: request.sessionId, turnId: request.turnId, requestId: request.requestId,
          decision: verdict.decision, ruleVersion: rule.version, lexiconVersion: rule.lexiconVersion, modelVersion: verdict.model,
        }, request.texts.join("\n"), req);
      }
      await audit(repo.payload, "system:moderation", `moderation.${verdict.decision}`, request.requestId, "自动审核执行记录", { stage: request.stage, rule: rule.version, lexicon: rule.lexiconVersion, model: verdict.model, keywordCount: verdict.keywordCount }, req);
    });
    if (verdict.decision === "block") throw new ContentReviewError(422, request.stage === "input"
      ? "这条请求未通过内容审核，可通过投诉与申诉入口申请复核"
      : "这次回应未通过内容审核，可通过投诉与申诉入口申请复核");
    if (["uncertain", "unavailable"].includes(verdict.decision)) throw new ContentReviewError(503, "内容审核暂未完成，已记录待复核事项，请稍后重试");
  };
}
