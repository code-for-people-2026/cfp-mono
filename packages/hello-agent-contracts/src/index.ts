import { z } from "zod";

// 只含跨端协议与校验；不能依赖 Payload、ADK 或 Node 运行时。
export const inputSchema = z
  .object({
    text: z.string().trim().max(4000).default(""),
    mediaIds: z.array(z.number().int().positive()).max(3).default([]),
  })
  .refine(
    (value) => value.text.length > 0 || value.mediaIds.length > 0,
    "请输入文字或上传图片",
  );
export const modeSchema = z.enum(["platform", "byok", "external"]);
export const turnSchema = z.object({
  sessionId: z.number().int().positive(),
  requestId: z.string().uuid(),
  input: inputSchema,
  mode: z.enum(["platform", "byok"]),
  apiKey: z.string().min(10).max(256).optional(),
});
export const greetingSchema = z.object({
  greeting: z.string().trim().min(2).max(1000),
  association: z.string().trim().min(1).max(500),
});
export const externalSchema = z.object({
  sessionId: z.number().int().positive(),
  requestId: z.string().uuid(),
  input: inputSchema,
  output: greetingSchema,
  model: z.string().trim().min(1).max(100),
});
export const sessionSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
});
export const sessionsSchema = z.array(sessionSchema);
export const turnResultSchema = z.object({
  id: z.number().int().positive(),
  input: inputSchema,
  status: z.enum(["running", "completed", "failed"]),
  mode: modeSchema,
  greeting: z.string().nullish(),
  association: z.string().nullish(),
  model: z.string().nullish(),
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
  previous: z.array(z.object({ input: inputSchema, greeting: z.string() })),
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
export const errorSchema = z.object({ error: z.string() });

export type Inspiration = z.output<typeof inputSchema>;
export type Greeting = z.output<typeof greetingSchema>;
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
