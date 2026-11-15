import { z } from "zod";
import { activityTypes } from "./types";
import { preferenceKeys } from "./preferences";

export const identifier = z.string().min(1).max(200);
const time = z.iso.datetime({ offset: true });
const amount = z.number().finite().min(0).max(100000).nullable().optional();
export const milkDescriptionSchema = z.string().trim().min(1).max(100);
export const milkItemSchema = z.object({
  id: identifier,
  milkSource: z.enum(["BREAST_MILK", "FORMULA"]).optional(),
  milkDescription: milkDescriptionSchema.optional(),
  milkAmount: amount,
  milkSourceState: z.enum(["known", "pending", "unknown"]).optional(),
  milkAmountState: z.enum(["known", "pending", "unknown"]).optional(),
}).strict().superRefine((item, context) => {
  if (item.milkSource !== undefined && item.milkDescription !== undefined) context.addIssue({ code: "custom", path: ["milkDescription"], message: "一个奶品明细不能同时使用标准奶源和原话奶品。" });
  if (item.milkSourceState === "known" && item.milkSource === undefined && item.milkDescription === undefined) context.addIssue({ code: "custom", path: ["milkSourceState"], message: "已知奶品必须提供标准奶源或原话奶品。" });
  if (item.milkAmountState === "known" && typeof item.milkAmount !== "number") context.addIssue({ code: "custom", path: ["milkAmountState"], message: "已知奶量必须提供实际喝入量。" });
  if (item.milkAmountState && item.milkAmountState !== "known" && item.milkAmount !== undefined && item.milkAmount !== null) context.addIssue({ code: "custom", path: ["milkAmount"], message: "待补或未知奶量不能同时携带数值。" });
});
export const milkItemsSchema = z.array(milkItemSchema).min(1).max(20).superRefine((items, context) => {
  if (new Set(items.map(item => item.id)).size !== items.length) context.addIssue({ code: "custom", message: "同一餐的奶品明细 ID 不能重复。" });
});
const reportedIntake = z.object({
  value: z.number().finite().min(0).max(100000),
  unit: z.literal("g"),
  originalText: z.string().max(4000).refine(text => text.trim().length > 0, "原话不能为空白"),
}).strict();
const factsSchema = z.object({
  type: z.enum(activityTypes).optional(), startTime: time.optional(), endTime: time.nullable().optional(), durationMinutes: z.number().finite().min(0).max(10080).optional(),
  reportedIntake: reportedIntake.nullable().optional(),
  milkAmount: amount, preparedMilkAmount: amount, remainingMilkAmount: amount, sameBottle: z.boolean().optional(),
  milkSource: z.enum(["BREAST_MILK", "FORMULA"]).optional(), milkDescription: milkDescriptionSchema.optional(), burpSuccess: z.boolean().nullable().optional(),
  milkItems: milkItemsSchema.optional(),
  breastFirmness: z.enum(["SOFT", "ELASTIC", "HARD"]).optional(),
  hasPoop: z.boolean().nullable().optional(), hasPee: z.boolean().nullable().optional(),
  poopColor: z.enum(["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"]).optional(),
  peeAmount: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
  count: z.number().int().min(0).max(100000).nullable().optional(),
  supplementType: z.enum(["AD", "D3", "PROBIOTICS", "PREBIOTICS"]).optional(),
  spitUpType: z.enum(["NORMAL", "PROJECTILE"]).optional(), notes: z.string().max(4000).nullable().optional(),
}).strict();
const fieldSchema = z.union([factsSchema.keyof(), z.literal("poopPhotoUrl")]);
export const sourceSchema = z.object({
  kind: z.enum(["chat", "wechat", "manual"]), accountId: identifier, conversationId: identifier,
  messageId: z.string().min(1).max(500), eventKey: identifier, sentAt: time, senderId: identifier,
  collectedAt: time.optional(), groupId: identifier.optional(), mediaIds: z.array(identifier).max(10).optional(),
}).strict();
/** @public Shared care-fact input rules for downstream chat tool contracts. */
export const ruleSchema = z.object({
  facts: factsSchema,
  states: z.partialRecord(fieldSchema, z.enum(["known", "pending", "unknown", "not_applicable", "not_yet"])).optional(),
  progress: z.enum(["ongoing", "ended", "unknown"]).optional(), intent: z.literal("feeding").optional(),
  evidence: z.array(z.object({ field: fieldSchema, kind: z.enum(["reported", "image", "extracted", "calculated", "default"]), sourceKey: z.string().max(200).optional(), detail: z.string().max(1000).optional(), confirmed: z.boolean() }).strict()).max(100).optional(),
}).strict();
export const milkItemAnswerSchema = z.object({
  milkItemId: identifier,
  facts: z.object({ milkSource: z.enum(["BREAST_MILK", "FORMULA"]).optional(), milkDescription: milkDescriptionSchema.optional(), milkAmount: amount }).strict().optional(),
  states: z.object({ milkSourceState: z.enum(["known", "pending", "unknown"]).optional(), milkAmountState: z.enum(["known", "pending", "unknown"]).optional() }).strict().optional(),
}).strict().superRefine((answer, context) => {
  if (answer.facts?.milkSource !== undefined && answer.facts.milkDescription !== undefined) context.addIssue({ code: "custom", path: ["facts"], message: "奶品答案不能同时提交标准奶源和原话奶品。" });
  if (!Object.keys(answer.facts || {}).length && !Object.keys(answer.states || {}).length) context.addIssue({ code: "custom", message: "奶品明细答案不能为空。" });
});
export const rulePatchSchema = ruleSchema.extend({ milkItemAnswers: z.array(milkItemAnswerSchema).min(1).max(20).optional() }).superRefine((value, context) => {
  if (value.milkItemAnswers && new Set(value.milkItemAnswers.map(item => item.milkItemId)).size !== value.milkItemAnswers.length) context.addIssue({ code: "custom", path: ["milkItemAnswers"], message: "一次补充不能重复修改同一奶品明细。" });
  if (value.states?.milkItems !== undefined) context.addIssue({ code: "custom", path: ["states", "milkItems"], message: "奶品明细状态由各项事实决定，不能通过根级状态修改。" });
  if (value.facts.type === "BOTTLE" && (value.states?.milkAmount !== undefined || value.states?.milkSource !== undefined || value.states?.milkDescription !== undefined)) {
    context.addIssue({ code: "custom", path: ["states"], message: "瓶喂根级奶量和奶源状态由奶品明细派生。" });
  }
});
const eventInputSchema = ruleSchema.extend({ sources: z.array(sourceSchema).max(100).optional(), attachmentIds: z.array(identifier).max(10).optional() }).superRefine((value, context) => {
  if (value.facts.type === "BOTTLE") {
    if (!value.facts.milkItems?.length) context.addIssue({ code: "custom", path: ["facts", "milkItems"], message: "新瓶喂记录必须提供奶品明细。" });
    if (value.facts.milkAmount !== undefined || value.facts.milkSource !== undefined || value.facts.milkDescription !== undefined) context.addIssue({ code: "custom", path: ["facts"], message: "瓶喂根级奶量和奶源由奶品明细派生，不能直接提交。" });
    if (value.states?.milkItems !== undefined || value.states?.milkAmount !== undefined || value.states?.milkSource !== undefined || value.states?.milkDescription !== undefined) context.addIssue({ code: "custom", path: ["states"], message: "瓶喂奶品明细及派生状态必须在 milkItems 各项中表达。" });
  }
});
export const baseMutation = z.object({ babyId: identifier, requestId: z.string().min(8).max(128) }).strict();
export const eventMutation = baseMutation.extend({ eventId: identifier, expectedVersion: z.number().int().positive() });
export const recordSchema = baseMutation.extend({ events: z.array(eventInputSchema).min(1).max(25) });
export const updateSchema = eventMutation.extend({ patch: rulePatchSchema, sources: z.array(sourceSchema).max(100).optional() });
export const querySchema = z.object({ babyId: identifier, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), eventId: identifier.optional(), includeRetracted: z.boolean().optional() }).strict();
export const answerSchema = baseMutation.extend({ questionId: identifier, questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive(), patch: rulePatchSchema, sources: z.array(sourceSchema).max(100).optional() });
const pendingBatchAnswerSchema = z.object({
  kind: z.literal("answer"), eventId: identifier, questionId: identifier,
  questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive(),
  patch: rulePatchSchema, sources: z.array(sourceSchema).max(100).optional(),
}).strict();
const pendingBatchDuplicateSchema = z.object({
  kind: z.literal("resolve_duplicate"), eventId: identifier, questionId: identifier,
  questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive(),
  resolution: z.enum(["distinct", "same"]), targetEventId: identifier.optional(), targetVersion: z.number().int().positive().optional(),
}).strict();
const pendingBatchOverlapSchema = z.object({
  kind: z.literal("confirm_overlap"), eventId: identifier, questionId: identifier,
  questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive(),
  conflictingEvents: z.array(z.object({ eventId: identifier, expectedVersion: z.number().int().positive() }).strict()).min(1).max(25),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const pendingBatchSchema = baseMutation.extend({
  items: z.array(z.discriminatedUnion("kind", [pendingBatchAnswerSchema, pendingBatchDuplicateSchema, pendingBatchOverlapSchema])).min(1).max(25),
}).superRefine((value, context) => {
  if (new Set(value.items.map(item => item.eventId)).size !== value.items.length) context.addIssue({ code: "custom", path: ["items"], message: "同一批次不能重复修改同一事件。" });
  if (new Set(value.items.map(item => item.questionId)).size !== value.items.length) context.addIssue({ code: "custom", path: ["items"], message: "同一批次不能重复回答同一问题。" });
});
export type PendingBatchInput = z.output<typeof pendingBatchSchema>;
export const preferenceKeySchema = z.enum(preferenceKeys);
export const preferenceValuesSchema = z.array(z.number().finite()).max(20).superRefine((values, context) => {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "常用选项不能重复。" });
});
const preferenceUpdatesSchema = z.array(z.object({ key: preferenceKeySchema, values: preferenceValuesSchema }).strict()).min(1).max(preferenceKeys.length);
const uniquePreferenceKeys = (input: { updates: Array<{ key: string }> }, context: z.RefinementCtx) => {
  if (new Set(input.updates.map(update => update.key)).size !== input.updates.length) context.addIssue({ code: "custom", path: ["updates"], message: "同一个配置项不能重复提交。" });
};
export const preferenceHttpUpdateSchema = z.object({
  requestId: z.string().min(8).max(128),
  expectedVersion: z.number().int().nonnegative(),
  updates: preferenceUpdatesSchema,
}).strict().superRefine(uniquePreferenceKeys);
export const preferenceUpdateSchema = z.object({
  babyId: identifier,
  requestId: z.string().min(8).max(128),
  expectedVersion: z.number().int().nonnegative(),
  updates: preferenceUpdatesSchema,
}).strict().superRefine(uniquePreferenceKeys);
