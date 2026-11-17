import { useCallback, useMemo } from "react";
import { Text, View } from "./taro-components";
import {
  A2UIProvider,
  A2UIRenderer,
  createCatalog,
  useA2UI,
  useA2UIError,
} from "@copilotkit/a2ui-renderer";
import type { A2uiMessage, SurfaceModel } from "@a2ui/web_core/v0_9";
import { artifactDefinitions, artifactRenderers } from "./a2ui-catalog";
import {
  useMessageFeed,
  surfaceIds,
  type ArtifactHostProps,
} from "./a2ui-feed";
import { useArtifactUi } from "./artifact-ui";

export function H5A2uiHost(props: ArtifactHostProps) {
  const catalog = useMemo(
    () =>
      createCatalog(artifactDefinitions, artifactRenderers, {
        catalogId: props.catalogId,
      }),
    [props.catalogId],
  );
  return (
    <A2UIProvider catalog={catalog}>
      <Surfaces {...props} />
    </A2UIProvider>
  );
}

function Surfaces({ messages, renderSurface }: ArtifactHostProps) {
  const { processMessages, clearSurfaces, getSurface } = useA2UI();
  const error = useA2UIError();
  const { labels } = useArtifactUi();
  const process = useCallback(
    (batch: A2uiMessage[]) =>
      processMessages(batch.map((message) => ({ ...message }))),
    [processMessages],
  );
  useMessageFeed(messages, process, clearSurfaces);
  if (error)
    return <Text className="artifact-error">{labels.renderingFailed}</Text>;
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
              loadingFallback={<Text>{labels.loadingArtifact}</Text>}
            />,
          )
        );
      })}
    </View>
  );
}

export type { ArtifactHostProps } from "./a2ui-feed";
