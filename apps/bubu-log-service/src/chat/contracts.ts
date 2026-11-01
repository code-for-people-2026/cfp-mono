import { z } from "zod";
import type { PendingMedia } from "../collector/service";
import type { PendingQuestion, RecordReceipt } from "../records/types";

const id = z.string().trim().min(1).max(200);
export const chatInputSchema = z.object({
  babyId: id,
  requestId: z.string().min(8).max(128),
  text: z.string().trim().max(6000).default(""),
  attachmentIds: z.array(id).max(3).default([]),
  context: z.object({
    viewedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    selectedEventId: id.optional(),
    mediaPendingId: id.optional(),
  }).strict(),
  question: z.object({ id, questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive() }).strict().optional(),
}).strict().refine(value => value.text.length > 0 || value.attachmentIds.length > 0, "请输入文字或选择照片。");
export type ChatInput = z.output<typeof chatInputSchema>;
export type ChatPending = ((PendingQuestion & { kind: "fields" }) | PendingMedia) & { prompt?: string };
export interface MediaReceipt { kind: "media"; id: string; sourceId: string; state: "resolved" | "open"; resolution: "provided" | "unknown" }
export type ChatReceipt = RecordReceipt | MediaReceipt;
export type ChatStatus = "processing" | "completed" | "failed" | "needs_recovery";
export interface ChatError { code: string; message: string; retryable: boolean }
export interface ChatTurn {
  id: string; requestId: string; conversationId: string; babyId: string;
  createdAt: string; updatedAt: string; status: ChatStatus;
  input: Omit<ChatInput, "babyId" | "requestId">;
  assistantText: string; replySource?: "ai" | "safety"; receipts: ChatReceipt[]; pending: ChatPending[];
  /** Refetch the calendar and trend projection. Never optimistically add a record. */
  refreshRequired: boolean;
  error?: ChatError;
}
export interface ChatHistory { conversationId: string; babyId: string; turns: ChatTurn[]; pending: ChatPending[]; pendingCount: number }

export interface ProviderCall { id: string; name: string; arguments: Record<string, unknown> }
export type ProviderContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
export interface ProviderMessage {
  role: "user" | "assistant" | "tool";
  content: ProviderContent | null;
  toolCalls?: ProviderCall[];
  toolCallId?: string;
}
export interface ProviderTool { name: string; description?: string; inputSchema: Record<string, unknown> }
export interface ProviderInput { instructions: string; messages: ProviderMessage[]; tools: ProviderTool[]; signal?: AbortSignal }
export interface ProviderOutput { text: string; calls: ProviderCall[] }
/** Production always uses a real configured provider. Test doubles are constructor injection only. */
export interface ChatProvider { complete(input: ProviderInput): Promise<ProviderOutput> }
