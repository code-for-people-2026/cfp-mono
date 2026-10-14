import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const identifier = z
  .string()
  .regex(/^(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/);
const base = { id: identifier, title: text(80) };
export const approachSchema = z.enum([
  "supportive",
  "cbt",
  "act",
  "dbt",
  "solution_focused",
  "self_compassion",
  "positive_psychology",
  "behavioral",
]);
export const fieldSchema = z
  .object({
    id: identifier,
    label: text(100),
    type: z.enum(["text", "longText", "number"]),
    required: z.boolean(),
    placeholder: z.string().max(120).optional(),
    min: z.number().min(-10000).max(10000).optional(),
    max: z.number().min(-10000).max(10000).optional(),
  })
  .strict();
export const cardSchema = z
  .object({
    ...base,
    kind: z.literal("card"),
    body: text(1200),
    items: z.array(text(300)).max(8).optional(),
  })
  .strict();
export const tableSchema = z
  .object({
    ...base,
    kind: z.literal("table"),
    columns: z.array(text(80)).min(1).max(6),
    rows: z
      .array(z.array(z.string().max(400)).min(1).max(6))
      .min(1)
      .max(20),
  })
  .strict();
export const formSchema = z
  .object({
    ...base,
    kind: z.literal("form"),
    description: text(500),
    fields: z.array(fieldSchema).min(1).max(10),
    submitLabel: text(30),
  })
  .strict();
export const pageSchema = z
  .object({
    ...base,
    kind: z.literal("page"),
    subtitle: z.string().max(200).optional(),
    sections: z
      .array(
        z
          .object({
            heading: text(100),
            body: text(1800),
            items: z.array(text(300)).max(8).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const coordinate = z.number().min(0).max(640);
export const shapeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("circle"),
      x: coordinate,
      y: coordinate,
      radius: z.number().positive().max(320),
      fill: color,
    })
    .strict(),
  z
    .object({
      type: z.literal("rect"),
      x: coordinate,
      y: coordinate,
      width: coordinate,
      height: coordinate,
      fill: color,
    })
    .strict(),
  z
    .object({
      type: z.literal("line"),
      x: coordinate,
      y: coordinate,
      x2: coordinate,
      y2: coordinate,
      stroke: color,
      width: z.number().positive().max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      x: coordinate,
      y: coordinate,
      text: text(40),
      fill: color,
      size: z.number().min(12).max(48),
    })
    .strict(),
]);
export const imageSchema = z
  .object({
    ...base,
    kind: z.literal("image"),
    alt: text(300),
    source: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("media"),
          mediaId: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          type: z.literal("illustration"),
          background: color,
          shapes: z.array(shapeSchema).min(1).max(50),
        })
        .strict(),
    ]),
  })
  .strict();
export const artifactSchema = z.discriminatedUnion("kind", [
  cardSchema,
  tableSchema,
  formSchema,
  pageSchema,
  imageSchema,
]);
export const artifactsSchema = z
  .array(artifactSchema)
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
  });
export const replySchema = z.object({
  greeting: z.string().trim().min(2).max(1000),
  association: text(500),
  approach: approachSchema.optional(),
  artifacts: artifactsSchema.optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;
export type FormArtifact = z.infer<typeof formSchema>;
export type PageArtifact = z.infer<typeof pageSchema>;
export type ImageArtifact = z.infer<typeof imageSchema>;
export type Reply = z.infer<typeof replySchema>;

export const formValuesSchema = z.record(
  identifier,
  z.union([z.string().max(1200), z.number().finite()]),
);
export const clientEventSchema = z
  .object({
    version: z.literal("v0.9.1"),
    action: z
      .object({
        name: z.literal("submit_form"),
        surfaceId: z.string().regex(/^turn_[1-9]\d*_[a-z][a-z0-9_]{0,39}$/),
        sourceComponentId: z.literal("submit"),
        timestamp: z.string().datetime(),
        context: z.object({ values: formValuesSchema }).strict(),
      })
      .strict(),
  })
  .strict();
export type ClientEvent = z.infer<typeof clientEventSchema>;
export type FormValues = z.infer<typeof formValuesSchema>;
export const formResponseSchema = z
  .object({
    turnId: z.number().int().positive(),
    artifactId: identifier,
    values: formValuesSchema,
  })
  .strict();

export function validateForm(
  form: FormArtifact,
  values: FormValues,
): string | undefined {
  if (
    Object.keys(values).some(
      (id) => !form.fields.some((field) => field.id === id),
    )
  )
    return "表单包含未知字段";
  for (const field of form.fields) {
    const value = values[field.id];
    if (value === undefined || String(value).trim() === "") {
      if (field.required) return `请填写「${field.label}」`;
      continue;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        return `「${field.label}」需要填写数字`;
      if (field.min !== undefined && value < field.min)
        return `「${field.label}」不能小于 ${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `「${field.label}」不能大于 ${field.max}`;
    } else if (typeof value !== "string" || value.length > 1200)
      return `请检查「${field.label}」的内容`;
  }
  return undefined;
}
