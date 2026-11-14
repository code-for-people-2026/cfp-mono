import { z } from "zod";
import {
  A2UI_VERSION,
  artifactSchema,
  cardSchema,
  identifier,
  imageSchema,
  legacyArtifactsSchema,
  pageSchema,
  artifactsSchema,
  formReferenceSchema,
  formValuesSchema,
  legacyArtifactsToA2ui,
  validateA2uiMessages,
  type A2uiMessage,
  type ClientEvent,
} from "@cfp/base-chat-protocol";

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

// Generation remains strict. Saved replay/history uses the bounded legacy decoder.
// Reuse the generic element and integrity checks, but expose an array maximum
// so tool-schema clients see a real one-item constraint rather than only a refinement.
const ajArtifactsSchema = z
  .array(artifactSchema)
  .max(1, "阿 J 一轮最多输出一件回应作品")
  .superRefine((items, ctx) => {
    const checked = artifactsSchema.safeParse(items, { jitless: true });
    if (!checked.success)
      for (const issue of checked.error.issues)
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });

export const replySchema = z.object({
  greeting: z.string().trim().min(2).max(1000),
  association: z.string().trim().min(1).max(500),
  approach: approachSchema.optional(),
  artifacts: ajArtifactsSchema.optional(),
});

const ajIdentifier = z
  .string()
  .regex(/^(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/);
// Historical AJ turn IDs were merely positive integers; do not invent a new
// 32-bit ceiling while replaying old records. Values beyond JS's safe integer
// range are ambiguous on the wire and must not be rounded into another turn.
const numericTurnId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const valuesSchema = formValuesSchema;

// This is the historical business request shape. The outer turn requestId is the
// form submission request ID; numeric turn ownership remains an AJ concern.
export const formResponseSchema = z
  .object({
    turnId: numericTurnId,
    artifactId: ajIdentifier,
    values: valuesSchema,
    presentation: formReferenceSchema.optional(),
  })
  .strict();

export const LEGACY_AJ_CATALOG_ID = "urn:cfp:hello-agent:catalog:1";
export const AJ_CATALOG_ID = "urn:cfp:hello-agent:catalog:2";
export const AJ_CATALOG_TITLE = "阿 J 先生 · 回应作品目录 v2";
export const AJ_PRESENTATION_REVISION = 1;
export const AJ_PRESENTATION_CATALOG_HEADER = "x-aj-presentation-catalog";
const catalogIds = [AJ_CATALOG_ID, LEGACY_AJ_CATALOG_ID] as const;
export const ajPresentationId = (turnId: number) =>
  `urn:cfp:a-j-oker:turn:${numericTurnId.parse(turnId)}`;
export const ajSurfaceName = (turnId: number, artifactId: string) =>
  `turn_${numericTurnId.parse(turnId)}_${ajIdentifier.parse(artifactId)}`;

function ajCatalogId(value: string) {
  const catalogId = catalogIds.find((candidate) => candidate === value);
  if (!catalogId) throw new Error("阿 J 先生界面目录不受支持");
  return catalogId;
}

export function ajCatalogIdForCapabilities(values: readonly string[]) {
  if (values.includes(AJ_CATALOG_ID)) return AJ_CATALOG_ID;
  if (values.includes(LEGACY_AJ_CATALOG_ID)) return LEGACY_AJ_CATALOG_ID;
  throw new Error("客户端不支持阿 J 先生的界面目录，请升级后重试");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

// Exact AJ catalog-v1 content envelope. It intentionally remains separate
// from the current shared schemas: accepting a v2 shape and merely changing
// its catalog ID would make strict deployed clients reject the message.
const legacyAjFieldSchema = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(100),
    type: z.enum(["text", "longText", "number"]),
    required: z.boolean(),
    placeholder: z.string().max(120).optional(),
    min: z.number().min(-10000).max(10000).optional(),
    max: z.number().min(-10000).max(10000).optional(),
  })
  .strict();
const legacyAjTableSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(80),
    kind: z.literal("table"),
    columns: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
    rows: z
      .array(z.array(z.string().max(400)).min(1).max(6))
      .min(1)
      .max(20),
  })
  .strict();
const legacyAjFormSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(80),
    kind: z.literal("form"),
    description: z.string().trim().min(1).max(500),
    fields: z.array(legacyAjFieldSchema).min(1).max(10),
    submitLabel: z.string().trim().min(1).max(30),
  })
  .strict();
const legacyAjArtifactSchema = z.union([
  cardSchema,
  legacyAjTableSchema,
  legacyAjFormSchema,
  pageSchema,
  imageSchema,
]);
export const legacyAjArtifactsSchema = z
  .array(legacyAjArtifactSchema)
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

const legacyAjValuesSchema = z.record(
  identifier,
  z.union([z.string().max(1200), z.number().finite()]),
);
const legacyAjComponentId = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const legacyAjBindingSchema = z
  .object({
    path: z
      .string()
      .regex(/^\/values\/(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/),
  })
  .strict();
export const legacyAjComponentSchema = z.discriminatedUnion("component", [
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Column"),
      children: z.array(legacyAjComponentId).max(64),
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Card"),
      child: legacyAjComponentId,
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Text"),
      text: z.string().max(2000),
      variant: z.enum(["h3", "body", "caption"]).optional(),
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Image"),
      url: z
        .string()
        .regex(
          /^\/api\/hello\/artifact-image\/[1-9]\d*\/[a-z][a-z0-9_]{0,39}$/,
        ),
      alt: z.string().max(300),
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Table"),
      columns: legacyAjTableSchema.shape.columns,
      rows: legacyAjTableSchema.shape.rows,
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Page"),
      page: pageSchema,
      url: z
        .string()
        .regex(
          /^\/api\/hello\/artifact-page\/[1-9]\d*\/[a-z][a-z0-9_]{0,39}$/,
        ),
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("FormField"),
      field: legacyAjFieldSchema,
      value: legacyAjBindingSchema,
    })
    .strict(),
  z
    .object({
      id: legacyAjComponentId,
      component: z.literal("Button"),
      child: legacyAjComponentId,
      action: z
        .object({
          event: z
            .object({
              name: z.literal("submit_form"),
              context: z
                .object({
                  values: z.object({ path: z.literal("/values") }).strict(),
                })
                .strict(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]);
const legacyAjSurfaceIdSchema = z
  .string()
  .regex(/^turn_[1-9]\d*_[a-z][a-z0-9_]{0,39}$/);
const legacyAjEnvelope = { version: z.literal(A2UI_VERSION) };
const legacyAjDataModelSchema = z
  .object({ values: legacyAjValuesSchema })
  .strict();
export const legacyAjA2uiMessageSchema = z.union([
  z
    .object({
      ...legacyAjEnvelope,
      createSurface: z
        .object({
          surfaceId: legacyAjSurfaceIdSchema,
          catalogId: z.literal(LEGACY_AJ_CATALOG_ID),
          sendDataModel: z.literal(false).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...legacyAjEnvelope,
      updateComponents: z
        .object({
          surfaceId: legacyAjSurfaceIdSchema,
          components: z.array(legacyAjComponentSchema).max(64),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...legacyAjEnvelope,
      updateDataModel: z
        .object({
          surfaceId: legacyAjSurfaceIdSchema,
          path: z
            .string()
            .regex(
              /^(\/|\/values|\/values\/(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39})$/,
            )
            .optional(),
          value: z
            .union([
              legacyAjDataModelSchema,
              legacyAjValuesSchema,
              z.string().max(1200),
              z.number().finite(),
            ])
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...legacyAjEnvelope,
      deleteSurface: z.object({ surfaceId: legacyAjSurfaceIdSchema }).strict(),
    })
    .strict(),
]);

export function projectAjArtifactsForLegacyClient(value: unknown) {
  const normalized = legacyArtifactsSchema.parse(value ?? [], { jitless: true });
  let compatible: z.output<typeof legacyAjArtifactsSchema> = [];
  for (const artifact of normalized) {
    if (
      artifact.kind === "code" ||
      (artifact.kind === "form" &&
        artifact.fields.some(
          (field) => field.type === "select" || field.type === "multiSelect",
        )) ||
      (artifact.kind === "table" &&
        artifact.rows.some((row) => row.some((cell) => !isString(cell))))
    )
      continue;
    const candidate = legacyAjArtifactsSchema.safeParse(
      [...compatible, artifact],
      { jitless: true },
    );
    if (candidate.success) compatible = candidate.data;
  }
  return compatible;
}

export function selectAjArtifactsForPresentation(value: unknown) {
  // Selection is presentation policy, not another schema gate: malformed history
  // stays untouched so the generic shared renderer can safe-parse and show its
  // graceful error rather than crashing this React useMemo.
  const parsed = legacyArtifactsSchema.safeParse(value ?? [], {
    jitless: true,
  });
  if (!parsed.success) return value ?? [];
  const artifacts = parsed.data;
  if (artifacts.length < 2) return artifacts;
  // Presentation-only policy for pre-launch records: preserve all stored data,
  // but render one conversational surface. A form is the most relevant follow-up.
  return [artifacts.find((artifact) => artifact.kind === "form") ?? artifacts[0]!];
}

export function toAjA2ui(
  turnId: number,
  artifacts: unknown,
  options: { catalogId?: string } = {},
): A2uiMessage[] {
  return legacyArtifactsToA2ui(selectAjArtifactsForPresentation(artifacts), {
    catalogId: options.catalogId ? ajCatalogId(options.catalogId) : AJ_CATALOG_ID,
    presentationId: ajPresentationId(turnId),
    revision: AJ_PRESENTATION_REVISION,
    surfaceId: (block) => ajSurfaceName(turnId, block.id),
    resourceUrl: ({ kind, block }) =>
      `/api/hello/artifact-${kind}/${turnId}/${block.id}`,
  });
}

export function toLegacyAjA2uiForClient(
  turnId: number,
  artifacts: unknown,
) {
  const safeTurnId = numericTurnId.parse(turnId);
  const compatible = projectAjArtifactsForLegacyClient(artifacts);
  return compatible.flatMap((artifact) => {
    const surfaceId = ajSurfaceName(safeTurnId, artifact.id);
    const components: z.output<typeof legacyAjComponentSchema>[] = [
      { id: "title", component: "Text", text: artifact.title, variant: "h3" },
    ];
    const children = ["title"];
    const add = (component: z.output<typeof legacyAjComponentSchema>) => {
      components.push(component);
      children.push(component.id);
    };
    switch (artifact.kind) {
      case "card":
        add({ id: "body", component: "Text", text: artifact.body });
        artifact.items?.forEach((item, index) =>
          add({ id: `item_${index}`, component: "Text", text: `• ${item}` }),
        );
        break;
      case "table":
        add({
          id: "table",
          component: "Table",
          columns: artifact.columns,
          rows: artifact.rows,
        });
        break;
      case "image":
        add({
          id: "image",
          component: "Image",
          url: `/api/hello/artifact-image/${safeTurnId}/${artifact.id}`,
          alt: artifact.alt,
        });
        break;
      case "page":
        add({
          id: "page",
          component: "Page",
          page: artifact,
          url: `/api/hello/artifact-page/${safeTurnId}/${artifact.id}`,
        });
        break;
      case "form":
        add({
          id: "description",
          component: "Text",
          text: artifact.description,
          variant: "caption",
        });
        artifact.fields.forEach((field) =>
          add({
            id: `field_${field.id}`,
            component: "FormField",
            field,
            value: { path: `/values/${field.id}` },
          }),
        );
        components.push({
          id: "submit_label",
          component: "Text",
          text: artifact.submitLabel,
        });
        add({
          id: "submit",
          component: "Button",
          child: "submit_label",
          action: {
            event: {
              name: "submit_form",
              context: { values: { path: "/values" } },
            },
          },
        });
        break;
    }
    components.push(
      { id: "content", component: "Column", children },
      { id: "root", component: "Card", child: "content" },
    );
    return [
      legacyAjA2uiMessageSchema.parse({
        version: A2UI_VERSION,
        createSurface: {
          surfaceId,
          catalogId: LEGACY_AJ_CATALOG_ID,
          sendDataModel: false,
        },
      }, { jitless: true }),
      legacyAjA2uiMessageSchema.parse({
        version: A2UI_VERSION,
        updateComponents: { surfaceId, components },
      }, { jitless: true }),
      legacyAjA2uiMessageSchema.parse({
        version: A2UI_VERSION,
        updateDataModel: { surfaceId, path: "/", value: { values: {} } },
      }, { jitless: true }),
    ];
  });
}

function primitiveLegacyValues(value: unknown) {
  return legacyAjValuesSchema.safeParse(value, { jitless: true }).success;
}

// Unversioned REST readers are deployed catalog-v1 clients. New readers opt in
// with AJ_PRESENTATION_CATALOG_HEADER. Projection affects only the response;
// saved rows and domain validation always retain the full current artifact.
export function ajCatalogIdForResponseHeader(value: string | null) {
  return value === AJ_CATALOG_ID ? AJ_CATALOG_ID : LEGACY_AJ_CATALOG_ID;
}

export function projectAjTurnForClient<
  T extends { artifacts?: unknown; input?: unknown },
>(turn: T, catalogId: string): T {
  if (ajCatalogId(catalogId) === AJ_CATALOG_ID) return turn;
  const projected = {
    ...turn,
    ...(turn.artifacts == null
      ? {}
      : { artifacts: projectAjArtifactsForLegacyClient(turn.artifacts) }),
  } as T;
  if (projected.input && typeof projected.input === "object") {
    const input = projected.input as Record<string, unknown>;
    const response = input.formResponse;
    if (response && typeof response === "object") {
      const formResponse = response as Record<string, unknown>;
      const nextInput: Record<string, unknown> = { ...input };
      if (primitiveLegacyValues(formResponse.values))
        nextInput.formResponse = {
          turnId: formResponse.turnId,
          artifactId: formResponse.artifactId,
          values: formResponse.values,
        };
      else delete nextInput.formResponse;
      projected.input = nextInput;
    }
  }
  return projected;
}

export function validateAjA2uiMessages(values: readonly unknown[]) {
  return validateA2uiMessages(values, { catalogIds });
}

export function ajClientEvent(options: {
  turnId: number;
  artifactId: string;
  values: z.input<typeof valuesSchema>;
  requestId: string;
  presentation?: z.input<typeof formReferenceSchema>;
}): ClientEvent {
  const turnId = numericTurnId.parse(options.turnId);
  const artifactId = ajIdentifier.parse(options.artifactId);
  const presentation = formReferenceSchema.parse(
    options.presentation ?? {
      presentationId: ajPresentationId(turnId),
      revision: AJ_PRESENTATION_REVISION,
      formId: artifactId,
    },
    { jitless: true },
  );
  if (
    presentation.presentationId !== ajPresentationId(turnId) ||
    presentation.revision !== AJ_PRESENTATION_REVISION ||
    presentation.formId !== artifactId
  )
    throw new Error("表单提交版本不匹配");
  return {
    version: "v0.9.1",
    action: {
      name: "submit_form",
      surfaceId: ajSurfaceName(turnId, artifactId),
      sourceComponentId: "submit",
      timestamp: new Date().toISOString(),
      context: {
        values: valuesSchema.parse(options.values, { jitless: true }),
        submission: {
          requestId: options.requestId,
          ...presentation,
        },
      },
    },
  };
}

export function ajFormResponseFromClientEvent(
  action: ClientEvent["action"],
): z.output<typeof formResponseSchema> {
  if (action.name !== "submit_form" || action.sourceComponentId !== "submit")
    throw new Error("表单来源不受支持");
  z.string().datetime().parse(action.timestamp);
  const match = action.surfaceId.match(
    /^turn_([1-9][0-9]*)_((?!constructor$|prototype$)[a-z][a-z0-9_]{0,39})$/,
  );
  if (!match) throw new Error("表单来源不受支持");
  const turnText = match[1];
  const artifactId = match[2];
  if (turnText === undefined || artifactId === undefined)
    throw new Error("表单来源不受支持");
  const turnId = numericTurnId.parse(Number(turnText));
  if (
    action.context.form &&
    (action.context.form.presentationId !== ajPresentationId(turnId) ||
      action.context.form.revision !== AJ_PRESENTATION_REVISION ||
      action.context.form.formId !== artifactId)
  )
    throw new Error("表单操作版本不匹配");
  if (action.context.submission) {
    if (
      action.context.submission.presentationId !== ajPresentationId(turnId) ||
      action.context.submission.revision !== AJ_PRESENTATION_REVISION ||
      action.context.submission.formId !== artifactId
    )
      throw new Error("表单提交版本不匹配");
  }
  return {
    turnId,
    artifactId,
    values: valuesSchema.parse(action.context.values, { jitless: true }),
    ...(action.context.submission
      ? {
          presentation: {
            presentationId: action.context.submission.presentationId,
            revision: action.context.submission.revision,
            formId: action.context.submission.formId,
          },
        }
      : {}),
  };
}
