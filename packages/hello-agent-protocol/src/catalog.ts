import { z } from "zod";
import { CATALOG_ID, componentSchema } from "./a2ui";

export function a2uiCatalog() {
  const anyComponent = z.toJSONSchema(componentSchema, {
    target: "draft-2020-12",
  });
  // A2UI structural validators identify child references using these standard definitions.
  for (const variant of anyComponent.oneOf ?? anyComponent.anyOf ?? []) {
    const properties = variant.properties;
    if (properties?.child)
      properties.child = {
        $ref: "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentId",
      };
    if (properties?.children)
      properties.children = {
        $ref: "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ChildList",
      };
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: CATALOG_ID,
    title: "阿J · 回应作品目录 v1",
    $defs: {
      anyComponent,
      theme: { type: "object", properties: {}, additionalProperties: false },
    },
  };
}
