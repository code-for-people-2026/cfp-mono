import { z as v3 } from "zod";
import { componentSchema } from "@cfp/a-j-oker-protocol";
import type {
  CatalogDefinitions,
  CatalogRenderers,
} from "@copilotkit/a2ui-renderer";
import { ArtifactComponent } from "./artifact-components";

// CopilotKit/web_core use Zod 3, while the wire/domain contracts use Zod 4.
// Bridge validation to the single source of truth instead of duplicating schemas.
// Our catalog deliberately uses literal props; editable values are explicit drafts
// in ArtifactState and the official data model, sent only by the submit action.
export const definitions: CatalogDefinitions = Object.fromEntries(
  componentSchema.options.map((schema) => {
    const component = schema.shape.component;
    const fields = Object.entries(schema.shape).filter(
      ([name]) => name !== "id" && name !== "component",
    );
    return [
      component.value,
      {
        props: v3
          .object(
            Object.fromEntries(
              fields.map(([key, field]) => [
                key,
                v3.custom(
                  (value) => field.safeParse(value, { jitless: true }).success,
                ),
              ]),
            ),
          )
          .strict(),
      },
    ];
  }),
);
export const renderers: CatalogRenderers<typeof definitions> =
  Object.fromEntries(
    Object.keys(definitions).map((name) => [
      name,
      ({ props, children, dispatch }) => (
        <ArtifactComponent
          component={componentSchema.parse(
            { ...props, id: "render", component: name },
            { jitless: true },
          )}
          child={children}
          dispatch={
            dispatch ||
            (() => {
              throw new Error("表单暂时无法提交");
            })
          }
        />
      ),
    ]),
  );
