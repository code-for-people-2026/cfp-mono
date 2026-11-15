import { z } from "zod";

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(1).max(40),
  phone: z.string().trim().regex(/^1[3-9]\d{9}$/),
  consent: z.literal(true),
  contactInformed: z.literal(true),
  version: z.literal("2026-10-24.v1"),
}).strict();
export const interactionStatusSchema = z.object({
  activeMs: z.number().nonnegative(),
  notice: z.object({ id: z.string(), kind: z.enum(["duration", "dependency", "crisis"]), text: z.string() }).nullable(),
  contact: z.object({ name: z.string(), phone: z.string(), consentedAt: z.string() }).nullable(),
  contactNotice: z.string(),
  contactVersion: z.literal("2026-10-24.v1"),
  support: z.object({ phone: z.string(), hours: z.string(), alertConfigured: z.boolean() }),
});
export type InteractionStatus = z.output<typeof interactionStatusSchema>;
