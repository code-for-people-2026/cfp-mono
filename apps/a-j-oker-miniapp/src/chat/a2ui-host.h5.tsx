import { useCallback } from "react";
import { View, Text } from "@tarojs/components";
import {
  A2UIProvider,
  A2UIRenderer,
  createCatalog,
  useA2UI,
  useA2UIError,
} from "@copilotkit/a2ui-renderer";
import type { A2uiMessage, SurfaceModel } from "@a2ui/web_core/v0_9";
import { CATALOG_ID } from "@cfp/a-j-oker-protocol";
import { definitions, renderers } from "./a2ui-catalog";
import { useMessageFeed, surfaceIds, type HostProps } from "./a2ui-feed";

const catalog = createCatalog(definitions, renderers, {
  catalogId: CATALOG_ID,
});
export function A2uiHost(props: HostProps) {
  return (
    <A2UIProvider catalog={catalog}>
      <Surfaces {...props} />
    </A2UIProvider>
  );
}
function Surfaces({ messages, renderSurface }: HostProps) {
  const { processMessages, clearSurfaces, getSurface } = useA2UI();
  const error = useA2UIError();
  const process = useCallback(
    (batch: A2uiMessage[]) =>
      processMessages(batch.map((message) => ({ ...message }))),
    [processMessages],
  );
  useMessageFeed(messages, process, clearSurfaces);
  if (error)
    return (
      <Text className="artifact-error">作品暂时无法显示，文字回复仍可阅读</Text>
    );
  return (
    <View>
      {surfaceIds(messages).map((id) => {
        const surface: SurfaceModel | undefined = getSurface(id);
        return (
          surface &&
          renderSurface(
            surface,
            <A2UIRenderer
              surfaceId={id}
              className="artifact-surface"
              loadingFallback={<Text>正在整理作品…</Text>}
            />,
          )
        );
      })}
    </View>
  );
}
