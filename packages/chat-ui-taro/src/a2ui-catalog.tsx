import { z as v3 } from "zod";
import { componentSchema } from "@cfp/base-chat-protocol";
import type {
  CatalogDefinitions,
  CatalogRenderers,
} from "@copilotkit/a2ui-renderer";
import { ArtifactComponent } from "./artifact-components";

export const artifactDefinitions: CatalogDefinitions = Object.fromEntries(
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

export const artifactRenderers: CatalogRenderers<typeof artifactDefinitions> =
  Object.fromEntries(
    Object.keys(artifactDefinitions).map((name) => [
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
