export {
  inputSchema,
  turnSchema,
  greetingSchema,
  externalSchema,
  type Inspiration,
  type Greeting,
  type Mode,
} from "@cfp/hello-agent-contracts";
export type Owner = { id: string; auth: "cookie" | "bearer" | "miniapp"; wechatKey?: string };

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Distinguishes a terminal moderation verdict from provider or storage failure.
export class ContentReviewError extends AppError {}
export class ContentPendingReviewError extends ContentReviewError {
  constructor(message = "这条内容需要人工复核，暂未放行，可通过投诉与申诉入口查看或补充说明") { super(409, message); }
}
