import { z } from "zod";

export const inputSchema = z
  .object({
    text: z.string().trim().max(4000).default(""),
    mediaIds: z.array(z.number().int().positive()).max(3).default([]),
  })
  .refine(
    (value) => value.text.length > 0 || value.mediaIds.length > 0,
    "请输入文字或上传图片",
  );

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

export type Inspiration = z.infer<typeof inputSchema>;
export type Greeting = z.infer<typeof greetingSchema>;
export type Mode = "platform" | "byok" | "external";
export type Owner = { id: string; auth: "cookie" | "bearer" | "miniapp" };

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
