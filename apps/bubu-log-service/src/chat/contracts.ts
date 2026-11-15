import { z } from "zod";
import type { PendingMedia } from "../collector/service";
import type { FirstWeekPatternSummary, PreferenceMutationReceipt } from "../records/preferences";
import { milkItemAnswerSchema, ruleSchema } from "../records/schemas";
import type { Field, PendingQuestion, RecordReceipt } from "../records/types";

const id = z.string().trim().min(1).max(200);
export const structuredFormAnswerSchema = z.object({
  facts: ruleSchema.shape.facts.optional(),
  states: ruleSchema.shape.states,
  progress: ruleSchema.shape.progress,
  milkItemAnswers: z.array(milkItemAnswerSchema).min(1).max(20).optional(),
}).strict().superRefine((value, context) => {
  if (value.milkItemAnswers && new Set(value.milkItemAnswers.map(item => item.milkItemId)).size !== value.milkItemAnswers.length) {
    context.addIssue({ code: "custom", path: ["milkItemAnswers"], message: "一次补充不能重复修改同一奶品明细。" });
  }
});
export type StructuredFormAnswer = z.output<typeof structuredFormAnswerSchema>;
export const choiceAnswerSchema = z.object({
  questionId: id,
  choiceId: id,
  originTurnId: id.optional(),
  eventVersion: z.number().int().positive().optional(),
}).strict();
export type ChoiceAnswer = z.output<typeof choiceAnswerSchema>;
const questionRefSchema = z.object({ id, questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive() }).strict();
export const formBatchItemSchema = z.object({
  eventId: id,
  question: questionRefSchema,
  formAnswer: structuredFormAnswerSchema.optional(),
  text: z.string().trim().min(1).max(6000).optional(),
  choiceAnswer: choiceAnswerSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const modes = Number(!!value.formAnswer) + Number(!!value.text) + Number(!!value.choiceAnswer);
  if (modes !== 1) ctx.addIssue({ code: "custom", message: "每项待补回答必须且只能使用表单、文字或选项中的一种。" });
  if (value.choiceAnswer?.originTurnId) ctx.addIssue({ code: "custom", path: ["choiceAnswer", "originTurnId"], message: "批量待补只能回答当前服务端待补选项。" });
});
export type FormBatchItem = z.output<typeof formBatchItemSchema>;
export const chatInputSchema = z.object({
  babyId: id,
  requestId: z.string().min(8).max(128),
  text: z.string().trim().max(6000).default(""),
  attachmentIds: z.array(id).max(3).default([]),
  formAnswer: structuredFormAnswerSchema.optional(),
  formBatch: z.array(formBatchItemSchema).min(1).max(25).optional(),
  context: z.object({
    viewedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    selectedEventId: id.optional(),
    mediaPendingId: id.optional(),
  }).strict(),
  question: questionRefSchema.optional(),
  choiceAnswer: choiceAnswerSchema.optional(),
}).strict().refine(value => value.text.length > 0 || value.attachmentIds.length > 0 || !!value.formAnswer || !!value.choiceAnswer || !!value.formBatch, "请输入文字、选择选项或选择照片。")
  .superRefine((value, ctx) => {
    if (value.choiceAnswer && value.formAnswer) ctx.addIssue({ code: "custom", path: ["choiceAnswer"], message: "选择题回答不能同时提交字段表单。" });
    if (value.formBatch) {
      if (value.attachmentIds.length) ctx.addIssue({ code: "custom", path: ["attachmentIds"], message: "批量待补不能携带照片。" });
      if (value.formAnswer || value.question || value.choiceAnswer || value.context.selectedEventId || value.context.mediaPendingId) {
        ctx.addIssue({ code: "custom", path: ["formBatch"], message: "批量待补不能混用单项回答或单项目标。" });
      }
      if (new Set(value.formBatch.map(item => item.eventId)).size !== value.formBatch.length) ctx.addIssue({ code: "custom", path: ["formBatch"], message: "同一批次不能重复回答同一事件。" });
      if (new Set(value.formBatch.map(item => item.question.id)).size !== value.formBatch.length) ctx.addIssue({ code: "custom", path: ["formBatch"], message: "同一批次不能重复回答同一问题。" });
      if (value.formBatch.reduce((sum, item) => sum + (item.text?.length || 0), 0) > 12000) ctx.addIssue({ code: "custom", path: ["formBatch"], message: "批量自定义说明总长度不能超过 12000 字。" });
    }
    if (!value.formAnswer) return;
    if (!value.question) ctx.addIssue({ code: "custom", path: ["question"], message: "结构化表单必须绑定原问题版本。" });
    if (!value.context.selectedEventId) ctx.addIssue({ code: "custom", path: ["context", "selectedEventId"], message: "结构化表单必须选择原事件。" });
    if (value.attachmentIds.length) ctx.addIssue({ code: "custom", path: ["attachmentIds"], message: "结构化表单不能同时携带照片。" });
    if (value.context.mediaPendingId) ctx.addIssue({ code: "custom", path: ["context", "mediaPendingId"], message: "结构化表单不能用于待补照片。" });
  });
export type ChatInput = z.output<typeof chatInputSchema>;
export type ChatFieldPending = PendingQuestion & { kind: "fields" } & { prompt?: string; form?: PendingEventForm };
export type ChatPending = ChatFieldPending | (PendingMedia & { prompt?: string });
export type ChatFormControlKind = "boolean" | "enum" | "number" | "timestamp" | "duration";
export interface ChatFormControl {
  field: Field;
  /** Stable client draft identity; item controls must not collide on the root field name. */
  draftKey: string;
  milkItemId?: string;
  milkItemLabel?: string;
  kind: ChatFormControlKind;
  label: string;
  options?: Array<{ label: string; value: string }>;
  optionsSource?: "manual" | "learned" | "default";
  unit?: "ml" | "minutes" | "times";
  referenceTime?: string;
  allowUnknown: true;
  allowNotYet?: true;
}
export interface PendingEventForm {
  eventId: string;
  eventVersion: number;
  questionId: string;
  questionVersion: number;
  title: string;
  activityType?: string;
  startedAt?: string;
  sourceSentAt?: string;
  knownSummary: string;
  controls: ChatFormControl[];
  progressControl?: PendingFormProgressControl;
  /** Conflicts and duplicate candidates deliberately require conversation; this form never auto-resolves them. */
  conflictMessages: string[];
  duplicateCandidateIds: string[];
}
export interface PendingFormProgressControl { field: "progress"; kind: "progress"; label: string; options: Array<{ label: string; value: "ongoing" | "ended" | "unknown" }> }
export interface MediaReceipt { kind: "media"; id: string; sourceId: string; state: "resolved" | "open"; resolution: "provided" | "unknown" }
export type ChatReceipt = RecordReceipt | MediaReceipt | PreferenceMutationReceipt;
export type ReplyChoiceAction =
  | { type: "reply"; text: string }
  | { type: "custom" }
  | { type: "attach"; text: string }
  | { type: "reference"; text: string; attachmentIds: string[] };
export interface ReplyChoice { id: string; label: string; action: ReplyChoiceAction }
export interface ReplyQuestionOrigin {
  kind: "turn" | "pending";
  turnId?: string;
  selectedEventId?: string;
  mediaPendingId?: string;
  question?: { id: string; questionVersion: number; eventVersion: number };
}
export interface ReplyQuestion { id: string; prompt: string; choices: ReplyChoice[]; origin: ReplyQuestionOrigin }
export type ChatStatus = "processing" | "completed" | "failed" | "needs_recovery";
export interface ChatError { code: string; message: string; retryable: boolean }
export interface ChatTurn {
  id: string; requestId: string; conversationId: string; babyId: string;
  createdAt: string; updatedAt: string; status: ChatStatus;
  input: Omit<ChatInput, "babyId" | "requestId">;
  assistantText: string; replyQuestions?: ReplyQuestion[]; replySource?: "ai" | "safety"; receipts: ChatReceipt[]; pending: ChatPending[];
  /** Refetch the calendar and trend projection. Never optimistically add a record. */
  refreshRequired: boolean;
  batchProgress?: { total: number; completed: number };
  error?: ChatError;
}
export interface AutomaticActivityMessage {
  id: string; requestId: string; groupId: string; eventIds: string[]; occurredAt: string;
  outcome: "saved" | "needs_information" | "pending_projection" | "conflict";
  text: string; events: Array<{ id: string; version: number; title: string; startedAt?: string; summary: string; complete: boolean }>;
}
export interface ChatHistory {
  conversationId: string; babyId: string; turns: ChatTurn[]; pending: ChatPending[]; pendingCount: number;
  replyQuestions: ReplyQuestion[];
  /** Collector-origin operation notices are shared baby record activity, never private caregiver utterances. */
  automaticMessages: AutomaticActivityMessage[];
  /** Baby-shared learned-pattern notice; never a caregiver or collector utterance. */
  firstWeekNotice?: FirstWeekPatternSummary;
}

export interface ProviderCall { id: string; name: string; arguments: Record<string, unknown> }
export type ProviderContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
export interface ProviderMessage {
  role: "user" | "assistant" | "tool";
  content: ProviderContent | null;
  toolCalls?: ProviderCall[];
  toolCallId?: string;
}
export interface ProviderTool { name: string; description?: string; inputSchema: Record<string, unknown> }
export interface ProviderResponseFormat { name: string; schema: Record<string, unknown>; strict?: boolean }
export interface ProviderInput { instructions: string; messages: ProviderMessage[]; tools: ProviderTool[]; responseFormat?: ProviderResponseFormat; signal?: AbortSignal }
export interface ProviderOutput { text: string; calls: ProviderCall[] }
/** Production always uses a real configured provider. Test doubles are constructor injection only. */
export interface ChatProvider { complete(input: ProviderInput): Promise<ProviderOutput> }
