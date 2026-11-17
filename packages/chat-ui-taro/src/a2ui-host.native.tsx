import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "./taro-components";
import {
  Catalog,
  ComponentContext,
  MessageProcessor,
  type SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { artifactDefinitions, artifactRenderers } from "./a2ui-catalog";
import {
  useMessageFeed,
  surfaceIds,
  type ArtifactHostProps,
} from "./a2ui-feed";

export function NativeA2uiHost({
  catalogId,
  messages,
  renderSurface,
}: ArtifactHostProps) {
  const catalog = useMemo(
    () =>
      new Catalog(
        catalogId,
        Object.entries(artifactDefinitions).map(([name, definition]) => ({
          name,
          schema: definition.props,
        })),
      ),
    [catalogId],
  );
  const processor = useMemo(() => new MessageProcessor([catalog]), [catalog]);
  const [, refresh] = useState(0);
  const process = useCallback(
    (batch: Parameters<typeof processor.processMessages>[0]) => {
      processor.processMessages(batch);
      refresh((version) => version + 1);
    },
    [processor],
  );
  const clear = useCallback(() => {
    for (const id of [...processor.model.surfacesMap.keys()])
      processor.model.deleteSurface(id);
  }, [processor]);
  useMessageFeed(messages, process, clear);
  return (
    <View>
      {surfaceIds(messages).map((id) => {
        const surface = processor.model.getSurface(id);
        return (
          surface &&
          renderSurface(
            surface,
            <View className="artifact-surface">
              <NativeTree surface={surface} id="root" />
            </View>,
          )
        );
      })}
    </View>
  );
}

function NativeTree({
  surface,
  id,
}: {
  surface: SurfaceModel;
  id: string;
}): ReactNode {
  const model = surface.componentsModel.get(id);
  if (!model) return null;
  const Render = artifactRenderers[model.type];
  if (!Render) return null;
  const context = new ComponentContext(surface, id);
  return (
    <Render
      props={model.properties}
      dispatch={(action) => context.dispatchAction(action)}
      children={(child) => (
        <NativeTree key={child} surface={surface} id={child} />
      )}
    />
  );
}

export type { ArtifactHostProps } from "./a2ui-feed";
