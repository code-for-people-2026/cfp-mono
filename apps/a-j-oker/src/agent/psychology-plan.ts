import {
  approachSchema,
  aJokerSchema,
  handoffPreambleSchema,
} from "@cfp/a-j-oker-contracts";
import { artifactsSchema } from "@cfp/base-chat-protocol";
import { z } from "zod";

const psychologyConsultationBaseSchema = z
  .object({
    request: z.string().trim().min(1).max(1200),
    urgency: z.enum(["routine", "immediate"]),
    knowledgeQuery: z.string().trim().min(1).max(80).optional(),
    // Produced by the coordinator in the same delegation decision. It is not
    // expert output and must never be saved as a partial final aJoker.
    userFacingIntro: handoffPreambleSchema.optional(),
  })
  .strict();

/** Internal continuation calls resume an already-active expert without a new handoff. */
const internalPsychologyConsultationSchema = psychologyConsultationBaseSchema;

/** The coordinator's initial delegation is user-facing and must explain itself first. */
export const psychologyConsultationSchema = psychologyConsultationBaseSchema
  .superRefine((value, ctx) => {
    if (value.urgency === "routine" && !value.userFacingIntro) {
      ctx.addIssue({
        code: "custom",
        path: ["userFacingIntro"],
        message: "常规专家交接必须提供 12～320 字的阿 J 用户可见前导说明",
      });
    }
  });

export type PsychologyConsultation = z.infer<
  typeof psychologyConsultationBaseSchema
>;

export const psychologyPlanSubmissionSchema = z
  .object({
    summary: z.string().trim().min(1).max(600),
    suggestions: z.array(z.string().trim().min(1).max(500)).max(3),
    needsImmediateSupport: z.boolean(),
    usedSourceIds: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
    artifacts: artifactsSchema.optional(),
    reply: aJokerSchema.optional(),
    lifecycle: z.enum(["continue", "complete"]).optional(),
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
    consultation: internalPsychologyConsultationSchema,
  })
  .strict();
