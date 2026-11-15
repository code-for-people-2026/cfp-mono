import { z } from "zod";
import {
  artifactsSchema,
  fieldSchema,
  formValuesSchema,
  pageSchema,
  tableSchema,
  type Artifact,
} from "./artifacts";

export const A2UI_VERSION = "v0.9.1" as const;
export const CATALOG_ID = "urn:cfp:hello-agent:catalog:1";
export const A2UI_EVENT = "a2ui";
const id = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const binding = z
  .object({
    path: z
      .string()
      .regex(/^\/values\/(?!constructor$|prototype$)[a-z][a-z0-9_]{0,39}$/),
  })
  .strict();
// An intentionally bounded catalog, shared by the H5 and Taro adapters.
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
      id,
      component: z.literal("Table"),
      columns: tableSchema.shape.columns,
      rows: tableSchema.shape.rows,
    })
    .strict(),
  z
    .object({
      id,
      component: z.literal("Page"),
      page: pageSchema,
      url: z
        .string()
        .regex(/^\/api\/hello\/artifact-page\/[1-9]\d*\/[a-z][a-z0-9_]{0,39}$/),
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
const surfaceId = z.string().regex(/^turn_[1-9]\d*_[a-z][a-z0-9_]{0,39}$/);
const dataModel = z.object({ values: formValuesSchema }).strict();
export const a2uiMessageSchema = z.union([
  z
    .object({
      ...envelope,
      createSurface: z
        .object({
          surfaceId,
          catalogId: z.literal(CATALOG_ID),
          sendDataModel: z.literal(false).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      updateComponents: z
        .object({ surfaceId, components: z.array(componentSchema).max(64) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      updateDataModel: z
        .object({
          surfaceId,
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
              z.string().max(1200),
              z.number().finite(),
            ])
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ ...envelope, deleteSurface: z.object({ surfaceId }).strict() })
    .strict(),
]);
export type A2uiMessage = z.infer<typeof a2uiMessageSchema>;
export const surfaceName = (turnId: number, artifactId: string) =>
  `turn_${turnId}_${artifactId}`;

export function toA2ui(turnId: number, value: unknown): A2uiMessage[] {
  const artifacts = artifactsSchema.parse(value ?? [], { jitless: true });
  return artifacts.flatMap((artifact) => {
    const surfaceId = surfaceName(turnId, artifact.id);
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
      case "image":
        add({
          id: "image",
          component: "Image",
          url: `/api/hello/artifact-image/${turnId}/${artifact.id}`,
          alt: artifact.alt,
        });
        break;
      case "page":
        add({
          id: "page",
          component: "Page",
          page: artifact,
          url: `/api/hello/artifact-page/${turnId}/${artifact.id}`,
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
      {
        version: A2UI_VERSION,
        createSurface: {
          surfaceId,
          catalogId: CATALOG_ID,
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

// Keep the product allowlist and resource limits here; the official A2UI core owns
// component/data state. This guard never applies data updates or resolves bindings.
export function validateA2uiMessages(
  values: readonly unknown[],
): A2uiMessage[] {
  if (values.length > 128) throw new Error("界面消息过多");
  const messages = values.map((value) =>
    a2uiMessageSchema.parse(value, { jitless: true }),
  );
  const surfaces = new Map<string, Map<string, Component>>();
  for (const message of messages) {
    if ("createSurface" in message) {
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
        for (const component of update.components)
          components.set(component.id, component);
        if (components.size > 64) throw new Error("界面内容过多");
        // Official web renderers assume an acyclic tree. Bound depth and expansion
        // before handing even partially streamed component graphs to them.
        for (const id of components.keys()) {
          let count = 0;
          function visit(key: string, ancestors: string[]) {
            if (
              ancestors.includes(key) ||
              ancestors.length > 8 ||
              ++count > 256
            )
              throw new Error("界面结构过深或循环引用");
            const item = components!.get(key);
            const children =
              item?.component === "Column"
                ? item.children
                : item?.component === "Card" || item?.component === "Button"
                  ? [item.child]
                  : [];
            for (const child of children) visit(child, [...ancestors, key]);
          }
          visit(id, []);
        }
      } else if (update.value !== undefined) {
        if (!update.path || update.path === "/")
          dataModel.parse(update.value, { jitless: true });
        else if (update.path === "/values")
          formValuesSchema.parse(update.value, { jitless: true });
        else
          z.union([z.string().max(1200), z.number().finite()]).parse(
            update.value,
            { jitless: true },
          );
      }
    }
  }
  return messages;
}

export function artifactSummary(artifacts: Artifact[]): string {
  // Keep the meaningful content (including questions), not rendering coordinates, in model memory.
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
