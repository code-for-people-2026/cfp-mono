import { z } from "zod";
import { offeringCategorySchema, relationshipIdSchema, zonedDateTimeSchema } from "./schemas";

export const operatorSessionSchema = z.object({
  operatorId: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  sellerName: z.string().trim().min(1).max(80),
  role: z.literal("operator"),
  expiresAt: zonedDateTimeSchema
}).strict();

export const authenticatedResponseSchema = z.object({
  status: z.literal("authenticated"),
  token: z.string().min(1),
  session: operatorSessionSchema
}).strict();

export const sellerSelectionResponseSchema = z.object({
  status: z.literal("seller-selection-required"),
  selectionToken: z.string().min(1),
  sellers: z.array(z.object({
    sellerId: relationshipIdSchema,
    sellerName: z.string().trim().min(1).max(80)
  }).strict()).min(2)
}).strict();

export const authResponseSchema = z.discriminatedUnion("status", [
  authenticatedResponseSchema,
  sellerSelectionResponseSchema
]);

export const wxLoginInputSchema = z.object({ code: z.string().min(1) }).strict();
export const devLoginInputSchema = z.object({ openid: z.string().min(1) }).strict();
export const selectSellerInputSchema = z.object({
  selectionToken: z.string().min(1),
  sellerId: relationshipIdSchema
}).strict();

export const apiErrorSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1)
}).passthrough();

const shortText = z.string().trim().min(1).max(80);
const mainIngredient = z.string().trim().max(80).nullable();

export const offeringSchema = z.object({
  id: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  name: shortText,
  mainIngredient,
  category: offeringCategorySchema,
  active: z.boolean()
}).strict();

export const offeringCreateSchema = z.object({
  name: shortText,
  mainIngredient: mainIngredient.optional(),
  category: offeringCategorySchema
}).strict();

export const offeringUpdateSchema = z.object({
  name: shortText.optional(),
  mainIngredient: mainIngredient.optional(),
  category: offeringCategorySchema.optional(),
  active: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "至少更新一个字段" });

const line = z.number().int().positive();
const raw = z.string();
const parsedOfferingSchema = offeringCreateSchema;

export const importPreviewRowSchema = z.discriminatedUnion("status", [
  z.object({
    line,
    raw,
    parsed: parsedOfferingSchema,
    status: z.literal("ready"),
    defaultAction: z.literal("create")
  }).strict(),
  z.object({
    line,
    raw,
    parsed: parsedOfferingSchema,
    status: z.literal("conflict"),
    existingId: relationshipIdSchema,
    defaultAction: z.literal("skip")
  }).strict(),
  z.object({
    line,
    raw,
    status: z.literal("invalid"),
    error: z.string().min(1)
  }).strict()
]);

const importTextSchema = z.string().min(1).max(20_000);
const previewSummarySchema = z.object({
  ready: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative()
}).strict();

export const importPreviewInputSchema = z.object({ text: importTextSchema }).strict();
export const importPreviewResponseSchema = z.object({
  rows: z.array(importPreviewRowSchema),
  summary: previewSummarySchema
}).strict();

export const importCommitInputSchema = z.object({
  text: importTextSchema,
  conflicts: z.array(z.object({
    line,
    action: z.literal("overwrite")
  }).strict()).max(50).default([])
}).strict().refine(
  ({ conflicts }) => new Set(conflicts.map((conflict) => conflict.line)).size === conflicts.length,
  { message: "同一行只能指定一次冲突操作" }
);

export const importCommitResultSchema = z.discriminatedUnion("status", [
  z.object({ line, status: z.literal("created"), id: relationshipIdSchema }).strict(),
  z.object({ line, status: z.literal("overwritten"), id: relationshipIdSchema }).strict(),
  z.object({ line, status: z.literal("skipped"), id: relationshipIdSchema }).strict(),
  z.object({ line, status: z.literal("failed"), error: z.string().min(1) }).strict()
]);

export const importCommitResponseSchema = z.object({
  results: z.array(importCommitResultSchema),
  summary: z.object({
    created: z.number().int().nonnegative(),
    overwritten: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }).strict()
}).strict();

export type OperatorSessionData = z.infer<typeof operatorSessionSchema>;
export type AuthenticatedResponse = z.infer<typeof authenticatedResponseSchema>;
export type SellerSelectionResponse = z.infer<typeof sellerSelectionResponseSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
