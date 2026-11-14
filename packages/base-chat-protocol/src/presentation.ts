import { z } from "zod";
import {
  artifactsSchema,
  cardSchema,
  formSchema,
  identifier,
  imageSchema,
  pageSchema,
} from "./artifacts";

export const PRESENTATION_VERSION = 1 as const;
export const presentationIdSchema = z.string().min(1).max(128);
export const requestIdSchema = z.string().min(1).max(128);
export const presentationRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(1_000_000_000_000);

export const presentationSchema = z
  .object({
    version: z.literal(PRESENTATION_VERSION),
    id: presentationIdSchema,
    revision: presentationRevisionSchema,
    blocks: artifactsSchema,
  })
  .strict();

// This is bounded replay compatibility, not an alias for current generation.
// Historical text fields could legally carry numeric min/max even though old
// validation only enforced those bounds for numbers. Replay drops unused text
// bounds and retains the historical five-artifact/24 KiB envelope.
const legacyBound = z.number().finite().min(-10000).max(10000);
const legacyTextFieldSchema = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "longText"]),
    required: z.boolean(),
    placeholder: z.string().max(120).optional(),
    min: legacyBound.optional(),
    max: legacyBound.optional(),
  })
  .strict()
  .transform(({ min: _min, max: _max, ...field }) => field);
const legacyNumberFieldSchema = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(100),
    type: z.literal("number"),
    required: z.boolean(),
    placeholder: z.string().max(120).optional(),
    min: legacyBound.optional(),
    max: legacyBound.optional(),
  })
  .strict();
const legacyFieldSchema = z.union([
  legacyTextFieldSchema,
  legacyNumberFieldSchema,
]);
const legacyTableSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(80),
    kind: z.literal("table"),
    columns: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
    rows: z.array(z.array(z.string().max(400)).min(1).max(6)).min(1).max(20),
  })
  .strict();
const legacyFormSchema = formSchema.extend({
  fields: z.array(legacyFieldSchema).min(1).max(10),
});
const legacyArtifactSchema = z.union([
  cardSchema,
  legacyTableSchema,
  legacyFormSchema,
  pageSchema,
  imageSchema,
]);
export const legacyArtifactsSchema = z.union([
  artifactsSchema,
  z
    .array(legacyArtifactSchema)
    .max(5)
    .superRefine((items, ctx) => {
      if (new Set(items.map((item) => item.id)).size !== items.length)
        ctx.addIssue({ code: "custom", message: "产物标识不能重复" });
      for (const item of items) {
        if (
          item.kind === "table" &&
          item.rows.some((row) => row.length !== item.columns.length)
        )
          ctx.addIssue({ code: "custom", message: "表格每行必须与列数一致" });
        if (item.kind === "form") {
          if (
            new Set(item.fields.map((field) => field.id)).size !==
            item.fields.length
          )
            ctx.addIssue({ code: "custom", message: "表单字段标识不能重复" });
          for (const field of item.fields)
            if (
              field.type === "number" &&
              field.min !== undefined &&
              field.max !== undefined &&
              field.min > field.max
            )
              ctx.addIssue({
                code: "custom",
                message: "表单最小值不能大于最大值",
              });
        }
      }
      if (JSON.stringify(items).length > 24000)
        ctx.addIssue({ code: "custom", message: "本轮产物内容过大" });
    }),
]);

export function presentationFromLegacyArtifacts(options: {
  id: string;
  revision: number;
  blocks: unknown;
}) {
  return presentationSchema.parse(
    {
      version: PRESENTATION_VERSION,
      id: presentationIdSchema.parse(options.id),
      revision: presentationRevisionSchema.parse(options.revision),
      blocks: legacyArtifactsSchema.parse(options.blocks, { jitless: true }),
    },
    { jitless: true },
  );
}

export type Presentation = z.output<typeof presentationSchema>;
