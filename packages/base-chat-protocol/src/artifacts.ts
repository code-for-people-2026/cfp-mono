import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const identifier = z
  .string()
  .regex(/^(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/);
const base = { id: identifier, title: text(80) };

export const fieldOptionSchema = z
  .object({
    id: identifier,
    label: text(120),
  })
  .strict();

const fieldCommon = {
  id: identifier,
  label: text(100),
  required: z.boolean(),
  placeholder: z.string().max(120).optional(),
};

export const fieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...fieldCommon,
      type: z.enum(["text", "longText"]),
    })
    .strict(),
  z
    .object({
      ...fieldCommon,
      type: z.literal("number"),
      min: z.number().finite().min(-10000).max(10000).optional(),
      max: z.number().finite().min(-10000).max(10000).optional(),
    })
    .strict(),
  z
    .object({
      ...fieldCommon,
      type: z.literal("select"),
      options: z.array(fieldOptionSchema).min(1).max(20),
      allowOther: z.boolean(),
      allowUnknown: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...fieldCommon,
      type: z.literal("multiSelect"),
      options: z.array(fieldOptionSchema).min(1).max(20),
      allowOther: z.boolean(),
      allowUnknown: z.boolean().optional(),
      minChoices: z.number().int().min(0).max(20).optional(),
      maxChoices: z.number().int().min(1).max(20).optional(),
    })
    .strict(),
]);

export const cardSchema = z
  .object({
    ...base,
    kind: z.literal("card"),
    body: text(1200),
    items: z.array(text(300)).max(8).optional(),
  })
  .strict();

export const tableCellSchema = z.union([
  z.string().max(400),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const tableSchema = z
  .object({
    ...base,
    kind: z.literal("table"),
    columns: z.array(text(80)).min(1).max(6),
    rows: z.array(z.array(tableCellSchema).min(1).max(6)).min(1).max(20),
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

export const codeLanguageSchema = z.enum([
  "text",
  "javascript",
  "typescript",
  "python",
  "json",
  "sql",
  "bash",
  "html",
  "css",
  "markdown",
  "yaml",
]);
export const codeSchema = z
  .object({
    ...base,
    kind: z.literal("code"),
    language: codeLanguageSchema,
    code: z.string().min(1).max(4000),
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
  codeSchema,
  pageSchema,
  imageSchema,
]);

export type Field = z.infer<typeof fieldSchema>;

function uniqueOptionIds(field: Field) {
  if (field.type === "select" || field.type === "multiSelect")
    return (
      new Set(field.options.map((option) => option.id)).size ===
      field.options.length
    );
  return true;
}

function validChoiceBounds(field: Field) {
  if (field.type !== "multiSelect") return true;
  // A required multi-select means “at least one answer” even when the producer
  // omits minChoices. An optional field may be left empty; a positive minimum
  // applies only once the user supplies an answer.
  const minimum = field.minChoices ?? (field.required ? 1 : 0);
  const capacity = field.options.length + (field.allowOther ? 1 : 0);
  const maximum = field.maxChoices ?? capacity;
  return minimum <= maximum && maximum <= capacity && (!field.required || minimum > 0);
}

export const artifactsSchema = z
  .array(artifactSchema)
  .max(6)
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
        for (const field of item.fields) {
          if (!uniqueOptionIds(field))
            ctx.addIssue({ code: "custom", message: "选项标识不能重复" });
          if (!validChoiceBounds(field))
            ctx.addIssue({
              code: "custom",
              message: "表单选项数量限制不正确",
            });
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
    }
    if (JSON.stringify(items).length > 32000)
      ctx.addIssue({ code: "custom", message: "本轮产物内容过大" });
  });

export const unknownAnswerSchema = z
  .object({ unknown: z.literal(true) })
  .strict();
export const choiceAnswerSchema = z
  .object({
    optionIds: z.array(identifier).max(20),
    otherText: z.string().trim().min(1).max(1200).optional(),
  })
  .strict();
export const formValueSchema = z.union([
  z.string().max(1200),
  z.number().finite(),
  choiceAnswerSchema,
  unknownAnswerSchema,
]);
export const formValuesSchema = z.record(identifier, formValueSchema);
export const formReferenceSchema = z
  .object({
    presentationId: z.string().min(1).max(128),
    revision: z.number().int().min(0).max(1_000_000_000_000),
    formId: identifier,
  })
  .strict();
export const formAnswerSchema = z
  .object({
    form: formReferenceSchema,
    requestId: z.string().min(1).max(128),
    answers: formValuesSchema,
  })
  .strict();

export type Artifact = z.infer<typeof artifactSchema>;
export type FormArtifact = z.infer<typeof formSchema>;
export type CodeArtifact = z.infer<typeof codeSchema>;
export type PageArtifact = z.infer<typeof pageSchema>;
export type ImageArtifact = z.infer<typeof imageSchema>;
export type FieldOption = z.infer<typeof fieldOptionSchema>;
export type TableCell = z.infer<typeof tableCellSchema>;
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;
export type UnknownAnswer = z.infer<typeof unknownAnswerSchema>;
export type FormValue = z.infer<typeof formValueSchema>;
export type FormValues = z.output<typeof formValuesSchema>;
export type FormReference = z.output<typeof formReferenceSchema>;
export type FormAnswer = z.output<typeof formAnswerSchema>;

function hasAnswer(value: FormValue | undefined): value is FormValue {
  if (value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return true;
  if ("unknown" in value) return value.unknown;
  return value.optionIds.length > 0 || !!value.otherText;
}

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
    // Empty strings represent a deliberately empty draft. An optional field is
    // valid when empty even if it has a positive answer-count minimum.
    if (!hasAnswer(value)) {
      if (field.required) return `请填写「${field.label}」`;
      continue;
    }
    if (typeof value === "object" && "unknown" in value) {
      if (
        (field.type === "select" || field.type === "multiSelect") &&
        field.allowUnknown
      )
        continue;
      return `「${field.label}」不支持未知答案`;
    }
    if (field.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value))
        return `「${field.label}」需要填写数字`;
      if (field.min !== undefined && value < field.min)
        return `「${field.label}」不能小于 ${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `「${field.label}」不能大于 ${field.max}`;
    } else if (field.type === "text" || field.type === "longText") {
      if (typeof value !== "string") return `「${field.label}」需要填写文字`;
    } else if (field.type === "select" || field.type === "multiSelect") {
      if (typeof value !== "object" || "unknown" in value)
        return `「${field.label}」的答案类型不正确`;
      if (new Set(value.optionIds).size !== value.optionIds.length)
        return `「${field.label}」不能重复选择`;
      const known = new Set(field.options.map((option) => option.id));
      if (value.optionIds.some((id) => !known.has(id)))
        return `「${field.label}」包含无效选项`;
      if (value.otherText !== undefined && !field.allowOther)
        return `「${field.label}」不支持补充说明`;
      const selected =
        value.optionIds.length + (value.otherText === undefined ? 0 : 1);
      if (field.type === "select" && selected > 1)
        return `「${field.label}」只能选择一项`;
      if (field.type === "multiSelect") {
        const minimum = field.minChoices ?? (field.required ? 1 : 0);
        const capacity = field.options.length + (field.allowOther ? 1 : 0);
        if (selected < minimum)
          return `「${field.label}」至少选择 ${minimum} 项`;
        const maximum = field.maxChoices ?? capacity;
        if (selected > maximum)
          return `「${field.label}」最多选择 ${maximum} 项`;
      }
      if (field.required && selected === 0)
        return `请选择或补充「${field.label}」`;
    } else {
      return `「${field.label}」的答案类型不正确`;
    }
  }
  return undefined;
}

export function artifactSummary(artifacts: Artifact[]): string {
  const summary = artifacts
    .map((item) =>
      item.kind === "image"
        ? `[图片] ${item.title}：${item.alt}`
        : JSON.stringify(item),
    )
    .join("\n");
  return summary.length <= 500
    ? summary
    : `${summary.slice(0, 465)}…（作品摘要节选，完整内容保留在原作品中）`;
}
