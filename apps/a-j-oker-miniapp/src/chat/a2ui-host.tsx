import { useCallback, useMemo, useState, type ReactNode } from "react";
import { View } from "@tarojs/components";
import {
  Catalog,
  ComponentContext,
  MessageProcessor,
  type SurfaceModel,
} from "@a2ui/web_core/v0_9";
import { CATALOG_ID } from "@cfp/base-chat-protocol";
import { definitions, renderers } from "./a2ui-catalog";
import { useMessageFeed, surfaceIds, type HostProps } from "./a2ui-feed";

const catalog = new Catalog(
  CATALOG_ID,
  Object.entries(definitions).map(([name, definition]) => ({
    name,
    schema: definition.props,
  })),
);
// Taro selects a2ui-host.h5.tsx for the web build. WeChat has no DOM, so only
// the final tree-to-native-elements adapter differs; official core owns all state.
export function A2uiHost({ messages, renderSurface }: HostProps) {
  const processor = useMemo(() => new MessageProcessor([catalog]), []);
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
  const Render = renderers[model.type];
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
