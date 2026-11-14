import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { View } from "./taro-components";
import {
  legacyArtifactsSchema,
  type A2uiMessage,
  type FormValues,
  type ImageArtifact,
} from "@cfp/base-chat-protocol";
import {
  ArtifactState,
  ArtifactImage,
  type ArtifactProps,
} from "./artifact-components";
import { ArtifactPreview, CompactCard } from "./artifact-preview";
import { BottomSheet } from "./bottom-sheet";
import {
  ArtifactUiProvider,
  useArtifactUi,
  type ArtifactUiConfig,
} from "./artifact-ui";
import type { ArtifactHostProps } from "./a2ui-feed";

export interface ArtifactRendererAdapter<Identity extends string | number> {
  catalogId: string;
  validate(messages: readonly unknown[]): A2uiMessage[];
  compile(identity: Identity, artifacts: unknown): A2uiMessage[];
}

type SurfaceProps = ArtifactProps & {
  messages: A2uiMessage[];
  responses: Record<string, FormValues>;
  compact?: boolean;
};

export function ArtifactSurfaces({
  Host,
  adapter,
  messages,
  responses,
  compact = true,
  ...props
}: SurfaceProps & {
  Host: ComponentType<ArtifactHostProps>;
  adapter: Pick<ArtifactRendererAdapter<string | number>, "catalogId" | "validate">;
}) {
  const { Text, labels } = useArtifactUi();
  const validated = useMemo(() => {
    try {
      return adapter.validate(messages);
    } catch {
      return undefined;
    }
  }, [adapter, messages]);
  if (!validated)
    return <Text className="artifact-error">{labels.unsupported}</Text>;
  return (
    <Host
      catalogId={adapter.catalogId}
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
            <ArtifactPreview surface={surface}>
              <ArtifactDetails external={props.external}>
                {content}
              </ArtifactDetails>
            </ArtifactPreview>
          ) : (
            <ArtifactDetails external={props.external}>{content}</ArtifactDetails>
          )}
        </ArtifactState>
      )}
    />
  );
}

function ArtifactDetails({
  external = false,
  children,
}: {
  external?: boolean;
  children: ReactNode;
}) {
  const { Text, labels } = useArtifactUi();
  return (
    <View data-ai-external={external ? "true" : "false"}>
      <Text className="artifact-caption">
        {labels.generated}
        {external ? labels.external : ""} · {labels.detailNonGeneratedContent()}
      </Text>
      {children}
    </View>
  );
}

export function LiveArtifacts({
  config,
  Host,
  adapter,
  messages,
}: {
  config: ArtifactUiConfig;
  Host: ComponentType<ArtifactHostProps>;
  adapter: Pick<ArtifactRendererAdapter<string | number>, "catalogId" | "validate">;
  messages: A2uiMessage[];
}) {
  return (
    <ArtifactUiProvider config={config}>
      <ArtifactSurfaces
        Host={Host}
        adapter={adapter}
        messages={messages}
        responses={{}}
        disabled
      />
    </ArtifactUiProvider>
  );
}

export function Artifacts<Identity extends string | number>({
  config,
  Host,
  adapter,
  identity,
  artifacts,
  ...props
}: ArtifactProps & {
  config: ArtifactUiConfig;
  Host: ComponentType<ArtifactHostProps>;
  adapter: ArtifactRendererAdapter<Identity>;
  identity: Identity;
  artifacts: unknown;
  responses: Record<string, FormValues>;
  compact?: boolean;
}) {
  return (
    <ArtifactUiProvider config={config}>
      <LegacyArtifactsContent
        Host={Host}
        adapter={adapter}
        identity={identity}
        artifacts={artifacts}
        {...props}
      />
    </ArtifactUiProvider>
  );
}

function LegacyArtifactsContent<Identity extends string | number>({
  Host,
  adapter,
  identity,
  artifacts,
  ...props
}: ArtifactProps & {
  Host: ComponentType<ArtifactHostProps>;
  adapter: ArtifactRendererAdapter<Identity>;
  identity: Identity;
  artifacts: unknown;
  responses: Record<string, FormValues>;
  compact?: boolean;
}) {
  const { Text, labels } = useArtifactUi();
  const parsed = useMemo(() => {
    const result = legacyArtifactsSchema.safeParse(artifacts ?? [], {
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
      adapter.compile(
        identity,
        parsed?.filter(
          (artifact) => images.length < 2 || artifact.kind !== "image",
        ) || [],
      ),
    [adapter, identity, parsed, images.length],
  );
  if (!parsed)
    return <Text className="artifact-error">{labels.unsupported}</Text>;
  return (
    <>
      <ArtifactSurfaces
        Host={Host}
        adapter={adapter}
        messages={messages}
        {...props}
      />
      {images.length > 1 && (
        <ImageCollection
          Host={Host}
          adapter={adapter}
          identity={identity}
          images={images}
          external={props.external}
        />
      )}
    </>
  );
}

function ImageCollection<Identity extends string | number>({
  Host,
  adapter,
  identity,
  images,
  external = false,
}: {
  Host: ComponentType<ArtifactHostProps>;
  adapter: ArtifactRendererAdapter<Identity>;
  identity: Identity;
  images: ImageArtifact[];
  external?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { labels } = useArtifactUi();
  const messages = useMemo(
    () => adapter.compile(identity, images),
    [adapter, identity, images],
  );
  const urls = useMemo(
    () =>
      messages.flatMap((message) =>
        "updateComponents" in message
          ? message.updateComponents.components.flatMap((component) =>
              component.component === "Image" ? [component.url] : [],
            )
          : [],
      ),
    [messages],
  );
  return (
    <>
      <CompactCard
        title={labels.imageCollectionTitle(images.length)}
        meta={`${labels.imageCollectionSummary(images.length)} · ${labels.generated}${external ? labels.external : ""}`}
        external={external}
        icon="image"
        preview={
          <View className="artifact-thumbnail-stack">
            {images.slice(0, 3).map((item, index) => (
              <ArtifactImage
                key={item.id}
                url={urls[index] || ""}
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
          title={labels.imageCollectionDialogTitle(images.length)}
          onClose={() => setOpen(false)}
        >
          <ArtifactSurfaces
            Host={Host}
            adapter={adapter}
            messages={messages}
            responses={{}}
            compact={false}
            external={external}
          />
        </BottomSheet>
      )}
    </>
  );
}
