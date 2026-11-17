export {
  inputSchema,
  turnSchema,
  greetingSchema,
  handoffPreambleSchema,
  externalSchema,
  type Inspiration,
  type Greeting,
  type Mode,
} from "@cfp/a-j-oker-contracts";
import type { RunInterimMessage } from "@cfp/base-chat-protocol";
export type Owner = { id: string; auth: "cookie" | "bearer" | "miniapp"; wechatKey?: string };

/**
 * Stable AJ progress stages transported through the generic AG-UI seam.
 * `stepName` remains human-readable for older clients; new clients key their
 * own wording off `stageId` and never receive product copy in the protocol.
 */
export const GENERATION_STAGE_IDS = [
  "generating",
  "expert_handoff",
  "expert_working",
  "expert_render",
  "render",
  "form_render",
  "image",
  "image_generation",
  "image_review",
] as const;
export type GenerationStageId = (typeof GENERATION_STAGE_IDS)[number];
export type GenerationProgress = {
  stageId: GenerationStageId;
  stepName: string;
  interimMessage?: RunInterimMessage;
};

export function renderProgress(
  artifacts: ReadonlyArray<{ kind: string }> | undefined,
  hasSpecialist: boolean,
): GenerationProgress | undefined {
  if (!artifacts?.length) return undefined;
  if (artifacts.some((artifact) => artifact.kind === "form"))
    return {
      stageId: "form_render",
      stepName: "正在准备可以直接填写的小卡片",
    };
  return hasSpecialist
    ? {
        stageId: "expert_render",
        stepName: "正在给这段对话换上专家的颜色",
      }
    : {
        stageId: "render",
        stepName: "阿 J 先生正在准备回应作品",
      };
}

export class AppError extends Error {
  readonly code?: string;
  readonly retryable?: boolean;
  readonly definitive?: boolean;

  constructor(
    public status: number,
    message: string,
    details: { code?: string; retryable?: boolean; definitive?: boolean } = {},
  ) {
    super(message);
    this.code = details.code;
    this.retryable = details.retryable;
    this.definitive = details.definitive;
  }
}

/** A safety-critical dependency failed before content could be classified. */
export class ServiceProblemError extends AppError {}

// Distinguishes a terminal moderation verdict from provider or storage failure.
export class ContentReviewError extends AppError {}
export class ContentPendingReviewError extends ContentReviewError {
  constructor(
    message = "这条内容需要人工复核，暂未放行，可通过投诉与申诉入口查看或补充说明",
    details: { code?: string; retryable?: boolean; definitive?: boolean } = {},
  ) { super(409, message, details); }
}
