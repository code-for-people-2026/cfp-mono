import { useMemo, useState } from "react";
import { Text, View } from "@tarojs/components";
import {
  artifactsSchema,
  toA2ui,
  validateA2uiMessages,
  type A2uiMessage,
  type FormValues,
  type ImageArtifact,
} from "@cfp/hello-agent-protocol";
import {
  ArtifactState,
  ArtifactImage,
  type ArtifactProps,
} from "./artifact-components";
import { A2uiHost } from "./a2ui-host";
import { ArtifactPreview, CompactCard } from "./artifact-preview";
import { BottomSheet } from "./bottom-sheet";

const emptyResponses: Record<string, FormValues> = {};
export function LiveArtifacts({ messages }: { messages: A2uiMessage[] }) {
  return (
    <ArtifactSurfaces messages={messages} responses={emptyResponses} disabled />
  );
}
function ArtifactSurfaces({
  messages,
  responses,
  compact = true,
  ...props
}: ArtifactProps & {
  messages: A2uiMessage[];
  responses: Record<string, FormValues>;
  compact?: boolean;
}) {
  // Reject unsupported components, unsafe paths and cycles before either renderer.
  const validated = useMemo(() => {
    try {
      return validateA2uiMessages(messages);
    } catch {
      return undefined;
    }
  }, [messages]);
  if (!validated)
    return (
      <Text className="artifact-error">作品格式暂不支持，文字回复仍可阅读</Text>
    );
  return (
    <A2uiHost
      messages={validated}
      renderSurface={(surface, content) => (
        <ArtifactState
          key={surface.id}
          surface={surface}
          {...props}
          submitted={!!responses[surface.id]}
          initialValues={responses[surface.id]}
        >
          {compact ? (
            <ArtifactPreview surface={surface}>{content}</ArtifactPreview>
          ) : (
            content
          )}
        </ArtifactState>
      )}
    />
  );
}
export function Artifacts({
  turnId,
  artifacts,
  ...props
}: ArtifactProps & {
  turnId: number;
  artifacts: unknown;
  responses: Record<string, FormValues>;
}) {
  const parsed = useMemo(() => {
    const result = artifactsSchema.safeParse(artifacts ?? [], {
      jitless: true,
    });
    return result.success ? result.data : undefined;
  }, [artifacts]);
  const images = useMemo(
    () => parsed?.filter((artifact) => artifact.kind === "image") || [],
    [parsed],
  );
  const messages = useMemo(
    () =>
      toA2ui(
        turnId,
        parsed?.filter(
          (artifact) => images.length < 2 || artifact.kind !== "image",
        ) || [],
      ),
    [turnId, parsed, images.length],
  );
  if (!parsed)
    return (
      <Text className="artifact-error">作品格式暂不支持，文字回复仍可阅读</Text>
    );
  return (
    <>
      <ArtifactSurfaces messages={messages} {...props} />
      {images.length > 1 && <ImageCollection turnId={turnId} images={images} />}
    </>
  );
}

function ImageCollection({
  turnId,
  images,
}: {
  turnId: number;
  images: ImageArtifact[];
}) {
  const [open, setOpen] = useState(false);
  const messages = useMemo(() => toA2ui(turnId, images), [turnId, images]);
  return (
    <>
      <CompactCard
        title="这一组图片"
        meta={`${images.length} 张图片 · 点开查看`}
        icon="image"
        preview={
          <View className="artifact-thumbnail-stack">
            {images.slice(0, 3).map((item) => (
              <ArtifactImage
                key={item.id}
                url={`/api/hello/artifact-image/${turnId}/${item.id}`}
                alt={item.alt}
                thumbnail
              />
            ))}
          </View>
        }
        onClick={() => setOpen(true)}
      />
      {open && (
        <BottomSheet
          title={`图片 · ${images.length} 张`}
          onClose={() => setOpen(false)}
        >
          <ArtifactSurfaces
            messages={messages}
            responses={emptyResponses}
            compact={false}
          />
        </BottomSheet>
      )}
    </>
  );
}
