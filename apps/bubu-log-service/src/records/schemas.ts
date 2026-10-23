import { z } from "zod";
import { activityTypes } from "./types";

export const identifier = z.string().min(1).max(200);
const time = z.iso.datetime({ offset: true });
const amount = z.number().finite().min(0).max(100000).nullable().optional();
export const factsSchema = z.object({
  type: z.enum(activityTypes).optional(), startTime: time.optional(), endTime: time.nullable().optional(), durationMinutes: z.number().finite().min(0).max(10080).optional(),
  milkAmount: amount, preparedMilkAmount: amount, remainingMilkAmount: amount, sameBottle: z.boolean().optional(),
  milkSource: z.enum(["BREAST_MILK", "FORMULA"]).optional(), burpSuccess: z.boolean().nullable().optional(),
  breastFirmness: z.enum(["SOFT", "ELASTIC", "HARD"]).optional(),
  hasPoop: z.boolean().nullable().optional(), hasPee: z.boolean().nullable().optional(),
  poopColor: z.enum(["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"]).optional(),
  peeAmount: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
  count: z.number().int().min(0).max(100000).nullable().optional(),
  supplementType: z.enum(["AD", "D3", "PROBIOTICS", "PREBIOTICS"]).optional(),
  spitUpType: z.enum(["NORMAL", "PROJECTILE"]).optional(), notes: z.string().max(4000).nullable().optional(),
}).strict();
export const fieldSchema = z.union([factsSchema.keyof(), z.literal("poopPhotoUrl")]);
export const sourceSchema = z.object({
  kind: z.enum(["chat", "wechat", "manual"]), accountId: identifier, conversationId: identifier,
  messageId: z.string().min(1).max(500), eventKey: identifier, sentAt: time, senderId: identifier,
  collectedAt: time.optional(), groupId: identifier.optional(), mediaIds: z.array(identifier).max(10).optional(),
}).strict();
export const ruleSchema = z.object({
  facts: factsSchema,
  states: z.partialRecord(fieldSchema, z.enum(["known", "pending", "unknown", "not_applicable", "not_yet"])).optional(),
  progress: z.enum(["ongoing", "ended", "unknown"]).optional(), intent: z.literal("feeding").optional(),
  evidence: z.array(z.object({ field: fieldSchema, kind: z.enum(["reported", "image", "extracted", "calculated"]), sourceKey: z.string().max(200).optional(), detail: z.string().max(1000).optional(), confirmed: z.boolean() }).strict()).max(100).optional(),
}).strict();
export const eventInputSchema = ruleSchema.extend({ sources: z.array(sourceSchema).max(100).optional(), attachmentIds: z.array(identifier).max(10).optional() });
export const baseMutation = z.object({ babyId: identifier, requestId: z.string().min(8).max(128) }).strict();
export const eventMutation = baseMutation.extend({ eventId: identifier, expectedVersion: z.number().int().positive() });
export const recordSchema = baseMutation.extend({ events: z.array(eventInputSchema).min(1).max(25) });
export const updateSchema = eventMutation.extend({ patch: ruleSchema, sources: z.array(sourceSchema).max(100).optional() });
export const querySchema = z.object({ babyId: identifier, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), eventId: identifier.optional(), includeRetracted: z.boolean().optional() }).strict();
export const answerSchema = baseMutation.extend({ questionId: identifier, questionVersion: z.number().int().positive(), eventVersion: z.number().int().positive(), patch: ruleSchema, sources: z.array(sourceSchema).max(100).optional() });
