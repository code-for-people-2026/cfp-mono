import { approachSchema } from "@cfp/a-j-oker-contracts";
import { artifactsSchema } from "@cfp/base-chat-protocol";
import { z } from "zod";

export const psychologyConsultationSchema = z
  .object({
    request: z.string().trim().min(1).max(1200),
    urgency: z.enum(["routine", "immediate"]),
    knowledgeQuery: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type PsychologyConsultation = z.infer<
  typeof psychologyConsultationSchema
>;

export const psychologyPlanSubmissionSchema = z
  .object({
    summary: z.string().trim().min(1).max(600),
    suggestions: z.array(z.string().trim().min(1).max(500)).max(3),
    needsImmediateSupport: z.boolean(),
    usedSourceIds: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
    artifacts: artifactsSchema.optional(),
  })
  .strict();

export type PsychologyPlanSubmission = z.infer<
  typeof psychologyPlanSubmissionSchema
>;

const psychologyReferenceSchema = z
  .object({
    library: z.string().max(120),
    title: z.string().max(500),
    excerpt: z.string().max(6000),
    sourceId: z.string().max(256).optional(),
    searchQuery: z.string().max(80).optional(),
    referenceId: z.string().max(80).optional(),
    readStatus: z
      .enum([
        "snippet",
        "document",
        "title_only",
        "restricted",
        "unavailable",
      ])
      .optional(),
    notice: z.string().max(500).optional(),
  })
  .strict();

/** AJ-owned structured result carried by the standard A2A DataPart. */
export const psychologyPlanSchema = psychologyPlanSubmissionSchema.extend({
  schemaVersion: z.literal(1),
  approach: approachSchema,
  references: z.array(psychologyReferenceSchema).max(6),
});

export type PsychologyPlan = z.infer<typeof psychologyPlanSchema>;

export const psychologyA2ARequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    approach: approachSchema,
    configurationRevision: z.string().trim().min(1).max(256),
    consultation: psychologyConsultationSchema,
  })
  .strict();

export type PsychologyA2ARequest = z.infer<typeof psychologyA2ARequestSchema>;
