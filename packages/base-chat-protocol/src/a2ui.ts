import { z } from "zod";
import {
  codeSchema,
  fieldSchema,
  formReferenceSchema,
  formValueSchema,
  formValuesSchema,
  tableSchema,
  pageSchema,
  validateForm,
  type Artifact,
  type FormAnswer,
} from "./artifacts";
import {
  presentationFromLegacyArtifacts,
  presentationSchema,
  requestIdSchema,
  type Presentation,
} from "./presentation";

export const A2UI_VERSION = "v0.9.1" as const;
export const DEFAULT_CATALOG_ID = "urn:cfp:chat:presentation:catalog:1";
export const A2UI_EVENT = "a2ui";
export const catalogIdSchema = z.string().min(1).max(256);
export const surfaceIdSchema = z.string().min(1).max(128);
const id = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const binding = z
  .object({
    path: z
      .string()
      .regex(/^\/values\/(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/),
  })
  .strict();
const resourceUrl = z
  .string()
  .max(512)
  .regex(
    /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(?:#[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/,
  );

// An intentionally bounded catalog, shared by platform renderers. Product owners
// choose their stable catalog ID; no route or product identity is embedded here.
export const componentSchema = z.discriminatedUnion("component", [
  z
    .object({
      id,
      component: z.literal("Column"),
      children: z.array(id).max(64),
    })
    .strict(),
  z.object({ id, component: z.literal("Card"), child: id }).strict(),
  z
    .object({
      id,
      component: z.literal("Text"),
      text: z.string().max(2000),
      variant: z.enum(["h3", "body", "caption"]).optional(),
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("Image"),
      url: resourceUrl,
      alt: z.string().max(300),
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("Table"),
      columns: tableSchema.shape.columns,
      rows: tableSchema.shape.rows,
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("Code"),
      code: codeSchema,
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("Page"),
      page: pageSchema,
      url: resourceUrl,
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("FormField"),
      field: fieldSchema,
      value: binding,
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("Button"),
      child: id,
      action: z
        .object({
          event: z
            .object({
              name: z.literal("submit_form"),
              context: z
                .object({
                  values: z.object({ path: z.literal("/values") }).strict(),
                  form: formReferenceSchema.optional(),
                })
                .strict(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]);
export type Component = z.infer<typeof componentSchema>;
const envelope = { version: z.literal(A2UI_VERSION) };
const dataModel = z.object({ values: formValuesSchema }).strict();
export const a2uiMessageSchema = z.union([
  z
    .object({
      ...envelope,
      createSurface: z
        .object({
          surfaceId: surfaceIdSchema,
          catalogId: catalogIdSchema,
          sendDataModel: z.literal(false).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      updateComponents: z
        .object({ surfaceId: surfaceIdSchema, components: z.array(componentSchema).max(64) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      updateDataModel: z
        .object({
          surfaceId: surfaceIdSchema,
          path: z
            .string()
            .regex(
              /^(\/|\/values|\/values\/(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39})$/,
            )
            .optional(),
          value: z
            .union([
              dataModel,
              formValuesSchema,
              formValueSchema,
              z.string().max(1200),
              z.number().finite(),
            ])
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ ...envelope, deleteSurface: z.object({ surfaceId: surfaceIdSchema }).strict() })
    .strict(),
]);
export type A2uiMessage = z.infer<typeof a2uiMessageSchema>;

export const clientSubmissionSchema = formReferenceSchema.extend({
  requestId: requestIdSchema,
});
export const clientEventSchema = z
  .object({
    version: z.literal(A2UI_VERSION),
    action: z
      .object({
        name: z.literal("submit_form"),
        surfaceId: surfaceIdSchema,
        sourceComponentId: id,
        timestamp: z.string().datetime(),
        context: z
          .object({
            values: formValuesSchema,
            form: formReferenceSchema.optional(),
            submission: clientSubmissionSchema.optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type ClientEvent = z.infer<typeof clientEventSchema>;

export function formAnswerFromClientEvent(
  presentationValue: unknown,
  action: ClientEvent["action"],
): FormAnswer {
  const presentation = presentationSchema.parse(presentationValue, {
    jitless: true,
  });
  const submission = action.context.submission;
  if (!submission) throw new Error("表单提交缺少版本标识");
  const form = presentation.blocks.find(
    (block) =>
      block.kind === "form" &&
      block.id === submission.formId &&
      submission.presentationId === presentation.id &&
      submission.revision === presentation.revision,
  );
  if (!form || form.kind !== "form") throw new Error("表单提交版本不匹配");
  const problem = validateForm(form, action.context.values);
  if (problem) throw new Error(problem);
  const { requestId, ...reference } = submission;
  return {
    form: reference,
    requestId,
    answers: action.context.values,
  };
}

export type A2uiResource =
  | { kind: "image"; block: Extract<Artifact, { kind: "image" }> }
  | { kind: "page"; block: Extract<Artifact, { kind: "page" }> };

export type CompileA2uiOptions = {
  catalogId: string;
  surfaceId: (block: Artifact) => string;
  resourceUrl: (resource: A2uiResource) => string;
};
export type LegacyCompileA2uiOptions = CompileA2uiOptions & {
  presentationId: string;
  revision: number;
};

function compilePresentation(
  presentation: Presentation,
  options: CompileA2uiOptions,
): A2uiMessage[] {
  return presentation.blocks.flatMap((artifact) => {
    const surfaceId = options.surfaceId(artifact);
    const components: Component[] = [
      { id: "title", component: "Text", text: artifact.title, variant: "h3" },
    ];
    const children = ["title"];
    const add = (component: Component) => {
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
      case "code":
        add({ id: "code", component: "Code", code: artifact });
        break;
      case "image":
        add({
          id: "image",
          component: "Image",
          url: options.resourceUrl({ kind: "image", block: artifact }),
          alt: artifact.alt,
        });
        break;
      case "page":
        add({
          id: "page",
          component: "Page",
          page: artifact,
          url: options.resourceUrl({ kind: "page", block: artifact }),
        });
        break;
      case "form": {
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
              context: {
                values: { path: "/values" },
                form: {
                  presentationId: presentation.id,
                  revision: presentation.revision,
                  formId: artifact.id,
                },
              },
            },
          },
        });
        break;
      }
    }
    components.push(
      { id: "content", component: "Column", children },
      { id: "root", component: "Card", child: "content" },
    );
    return [
      {
        version: A2UI_VERSION,
        createSurface: {
          surfaceId,
          catalogId: options.catalogId,
          sendDataModel: false,
        },
      },
      { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
      {
        version: A2UI_VERSION,
        updateDataModel: { surfaceId, path: "/", value: { values: {} } },
      },
    ];
  });
}

export function presentationToA2ui(
  value: unknown,
  options: CompileA2uiOptions,
): A2uiMessage[] {
  return compilePresentation(
    presentationSchema.parse(value, { jitless: true }),
    options,
  );
}

export function legacyArtifactsToA2ui(
  value: unknown,
  options: LegacyCompileA2uiOptions,
): A2uiMessage[] {
  return compilePresentation(
    presentationFromLegacyArtifacts({
      id: options.presentationId,
      revision: options.revision,
      blocks: value ?? [],
    }),
    options,
  );
}

// Keep the component allowlist and resource limits here; the official A2UI core
// owns component/data state. This guard never applies data updates or resolves bindings.
export function validateA2uiMessages(
  values: readonly unknown[],
  options: { catalogIds?: readonly string[] } = {},
): A2uiMessage[] {
  if (values.length > 128) throw new Error("界面消息过多");
  const catalogIds = new Set(options.catalogIds ?? [DEFAULT_CATALOG_ID]);
  const messages = values.map((value) =>
    a2uiMessageSchema.parse(value, { jitless: true }),
  );
  const surfaces = new Map<string, Map<string, Component>>();
  for (const message of messages) {
    if ("createSurface" in message) {
      if (!catalogIds.has(message.createSurface.catalogId))
        throw new Error("界面目录不受支持");
      const key = message.createSurface.surfaceId;
      if (surfaces.has(key)) throw new Error("界面已存在");
      if (surfaces.size >= 10) throw new Error("界面数量过多");
      surfaces.set(key, new Map());
    } else if ("deleteSurface" in message) {
      surfaces.delete(message.deleteSurface.surfaceId);
    } else {
      const update =
        "updateComponents" in message
          ? message.updateComponents
          : message.updateDataModel;
      const components = surfaces.get(update.surfaceId);
      if (!components) throw new Error("界面尚未创建");
      if ("components" in update) {
        if (new Set(update.components.map((component) => component.id)).size !== update.components.length)
          throw new Error("界面组件标识不能重复");
        for (const component of update.components)
          components.set(component.id, component);
        if (components.size > 64) throw new Error("界面内容过多");
        // Official web renderers assume an acyclic tree. Bound depth and expansion
        // before handing even partially streamed component graphs to them.
        for (const componentId of components.keys()) {
          let count = 0;
          const surfaceComponents = components;
          function visit(key: string, ancestors: string[]) {
            if (
              ancestors.includes(key) ||
              ancestors.length > 8 ||
              ++count > 256
            )
              throw new Error("界面结构过深或循环引用");
            const item = surfaceComponents.get(key);
            const children =
              item?.component === "Column"
                ? item.children
                : item?.component === "Card" || item?.component === "Button"
                  ? [item.child]
                  : [];
            for (const child of children) visit(child, [...ancestors, key]);
          }
          visit(componentId, []);
        }
      } else if (update.value !== undefined) {
        if (!update.path || update.path === "/")
          dataModel.parse(update.value, { jitless: true });
        else if (update.path === "/values")
          formValuesSchema.parse(update.value, { jitless: true });
        else formValueSchema.parse(update.value, { jitless: true });
      }
    }
  }
  return messages;
}
