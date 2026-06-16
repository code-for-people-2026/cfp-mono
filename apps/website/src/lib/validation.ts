import { z } from "zod";

export const chatMessageSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2_000),
});

export const chatRequestSchema = z.object({
  mode: z.enum(["intro", "doubt", "continue", "free"]),
  message: z.string().min(1).max(1_000),
  messages: z.array(chatMessageSchema).max(8),
  conversationSummary: z.string().max(800).optional().default(""),
});

export const summarizeRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(12),
  previousSummary: z.string().max(800).optional().default(""),
});
