export * from "./age";
export * from "./profile";
export * from "./service-scope";
export * from "./presentation";
import { z } from "zod";
import {
  legacyArtifactsSchema,
  presentationAvatarSchema,
} from "@cfp/base-chat-protocol";
import {
  approachSchema,
  formResponseSchema,
  replySchema,
} from "./presentation";

// 只含跨端协议与校验；不能依赖 Payload、ADK 或 Node 运行时。
export const inputSchema = z
  .object({
    text: z.string().trim().max(4000).default(""),
    mediaIds: z.array(z.number().int().positive()).max(3).default([]),
    formResponse: formResponseSchema.optional(),
    action: z
      .object({
        type: z.literal("return_to_coordinator"),
        taskId: z.string().trim().min(1).max(128),
      })
      .strict()
      .optional(),
  })
  .refine(
    (value) =>
      value.text.length > 0 ||
      value.mediaIds.length > 0 ||
      !!value.formResponse ||
      !!value.action,
    "请输入文字或上传图片",
  )
  .refine(
    (value) => !value.action || (
      value.text.length === 0 &&
      value.mediaIds.length === 0 &&
      !value.formResponse
    ),
    "返回操作不能同时携带文字、图片或表单",
  );
export const modeSchema = z.enum(["platform", "byok", "external"]);
export const turnSchema = z.object({
  sessionId: z.number().int().positive(),
  requestId: z.string().uuid(),
  input: inputSchema,
  mode: z.enum(["platform", "byok"]),
  apiKey: z.string().min(10).max(256).optional(),
});
export const aJokerSchema = replySchema;
export const handoffPreambleSchema = z
  .string()
  .trim()
  .min(12)
  .max(320);
export const expertExecutionDiagnosticSchema = z.object({
  executionId: z.string().trim().min(1).max(128),
  taskId: z.string().trim().min(1).max(128),
  expertId: approachSchema,
  attempt: z.number().int().min(1).max(3),
  phase: z.enum([
    "recovery",
    "execution",
    "validation",
    "artifact",
    "retry",
    "terminal",
  ]),
  errorKind: z.enum([
    "provider_network",
    "provider_http",
    "provider_response",
    "plan_validation",
    "no_submission",
    "session_persistence",
    "auth",
    "policy",
    "cancel",
    "unknown",
  ]),
  errorName: z.enum([
    "DeepSeekError",
    "ZodError",
    "AbortError",
    "TimeoutError",
    "Error",
  ]),
  status: z.number().int().min(100).max(599).optional(),
  code: z.string().trim().regex(/^[A-Z0-9_]{1,64}$/).optional(),
  cause: z.enum([
    "network",
    "timeout",
    "http_status",
    "response_json",
    "response_schema",
    "response_envelope",
    "plan_schema",
    "approach_mismatch",
    "no_submission",
    "session_persistence",
    "credential",
    "policy",
    "canceled",
    "unknown",
  ]),
  disposition: z.enum([
    "retry_scheduled",
    "retry_exhausted",
    "nonretryable",
    "canceled",
    "recovery_unavailable",
    "completed",
  ]),
}).strict();
export type ExpertExecutionDiagnostic = z.output<typeof expertExecutionDiagnosticSchema>;
export const expertHandoffStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["active", "completed", "failed"]),
  attempts: z.number().int().min(0).max(3),
  finalDisposition: z.enum([
    "retry_exhausted",
    "nonretryable",
    "canceled",
    "recovery_unavailable",
    "completed",
  ]),
  diagnostics: z.array(expertExecutionDiagnosticSchema).max(3),
}).strict();
export type ExpertHandoffState = z.output<typeof expertHandoffStateSchema>;
export const externalSchema = z.object({
  sessionId: z.number().int().positive(),
  requestId: z.string().uuid(),
  input: inputSchema,
  output: aJokerSchema,
  model: z.string().trim().min(1).max(100),
});
export const sessionSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export const sessionsSchema = z.array(sessionSchema);
export const turnResultSchema = z.object({
  id: z.number().int().positive(),
  retryOfTurnId: z.number().int().positive().optional(),
  input: inputSchema,
  status: z.enum(["running", "completed", "failed"]),
  visibility: z.literal("quarantined").optional(),
  imageGeneration: z.object({ status: z.enum(["submitting", "pending", "stored", "failed", "blocked"]), canResume: z.boolean() }).nullish(),
  mode: modeSchema,
  aJoker: z.string().nullish(),
  handoffPreamble: handoffPreambleSchema.nullish(),
  error: z.string().nullish(),
  association: z.string().nullish(),
  approach: z.string().nullish(),
  artifacts: legacyArtifactsSchema.nullish(),
  model: z.string().nullish(),
  specialist: z
    .object({
      taskId: z.string().min(1).max(128),
      expertId: approachSchema,
      name: z.string().min(1).max(80),
      method: z.string().min(1).max(120),
      configurationRevision: z.string().min(1).max(256),
      theme: z.enum(["sage", "blue", "plum", "amber"]),
      layout: z.enum(["reflection", "step_by_step", "action_plan"]),
      subtitle: z.string().trim().min(1).max(80).optional(),
      status: z.enum(["active", "completed", "unavailable"]),
      handoff: expertHandoffStateSchema.optional(),
      // Opaque local-asset identity. Historical snapshots may predate it and
      // remain valid; AJ clients resolve only references they explicitly bundle.
      avatarReference: presentationAvatarSchema.shape.reference.optional(),
      sources: z.array(z.object({
        library: z.string().max(120),
        title: z.string().max(500),
        readStatus: z.enum(["snippet", "document"]),
      }).strict()).max(6),
    })
    .strict()
    .nullish(),
  createdAt: z.string(),
});
export const historySchema = z.array(turnResultSchema);
export const submissionResultSchema = z.object({
  turn: turnResultSchema.nullable(),
});
export const advertisementSchema = z.object({
  mode: z.enum(["demo", "wechat", "disabled"]),
  adUnitId: z.string(),
  demoSeconds: z.number(),
});
export const settingsSchema = z.object({
  platformConfigured: z.boolean(),
  imageGenerationConfigured: z.boolean().optional(),
  model: z.string(),
  origin: z.string(),
  advertisement: advertisementSchema,
});
export const memoryStatusSchema = z.object({
  revision: z.number().int().nonnegative().default(0),
  usedTokens: z.number(),
  budgetTokens: z.number(),
  remainingPercent: z.number(),
  level: z.enum(["healthy", "low", "empty"]),
  canCompact: z.boolean(),
  candidateCount: z.number(),
  recentTurns: z.number(),
  compressions: z.number(),
  summary: z.string(),
  rewardReady: z.boolean(),
  recoveryMode: z
    .enum(["advertisement", "preview", "disabled"])
    .default("advertisement"),
  advertisement: advertisementSchema,
});
export const modelContextSchema = z.object({
  memory: z.string(),
  previous: z.array(z.object({ input: inputSchema, aJoker: z.string() })),
});
export const agentContextSchema = z.object({
  context: modelContextSchema,
  status: memoryStatusSchema,
});
export const adTicketSchema = advertisementSchema.extend({
  rewardId: z.string(),
  completed: z.boolean(),
});
export const uploadResultSchema = z.object({ id: z.number().int().positive() });
export const credentialSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
});
export const identitySchema = z.object({ owner: z.string() });
export const completedSchema = z.object({ completed: z.boolean() });
export const revokedSchema = z.object({ revoked: z.boolean() });
export const errorSchema = z.object({
  error: z.string(),
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/).optional(),
  retryable: z.boolean().optional(),
  definitive: z.boolean().optional(),
});

export type Inspiration = z.output<typeof inputSchema>;
export type AJoker = z.output<typeof aJokerSchema>;
export type Mode = z.output<typeof modeSchema>;
export type Session = z.output<typeof sessionSchema>;
export type Turn = z.output<typeof turnResultSchema>;
export type Settings = z.output<typeof settingsSchema>;
export type MemoryStatus = z.output<typeof memoryStatusSchema>;
export type Advertisement = z.output<typeof advertisementSchema>;
export type AdTicket = z.output<typeof adTicketSchema>;
export type ModelContext = z.output<typeof modelContextSchema>;

// 网络输入在校验前必须保持未知，不能靠泛型声明“相信”服务器。
export type Decoder<T> = {
  parse(value: unknown, options?: { jitless?: boolean }): T;
};

export * from "./privacy";
export * from "./interaction";

export const safetyReceiptSchema = z.object({ receipt: z.string(), kind: z.string(), status: z.string(), createdAt: z.string(), reply: z.string().nullish(), acceptBy: z.string().nullish(), resolveBy: z.string().nullish(), canAppeal: z.boolean(), turnId: z.number().nullish() });
export const safetyStatusSchema = z.object({ configuration: z.object({ notice: z.string().optional(), configured: z.boolean(), acceptanceHours: z.number().optional(), resolutionHours: z.number().optional(), feedbackHours: z.number().optional() }), cases: z.array(safetyReceiptSchema) });
export type SafetyReceipt = z.output<typeof safetyReceiptSchema>;
