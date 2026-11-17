import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Button, Image, Text, View } from "./taro-components";
import {
  legacyArtifactsSchema,
  presentationOriginSchema,
  type A2uiMessage,
  type FormValues,
  type ImageArtifact,
  type PresentationOrigin,
} from "@cfp/base-chat-protocol";
import {
  ArtifactState,
  ArtifactImage,
  ConfirmedFormSummary,
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
import type { SurfaceModel } from "@a2ui/web_core/v0_9";

export function PresentationOriginHeader({
  origin,
  avatarSource,
  notice,
  exitLabel,
  exitDisabled,
  onExit,
  showSources = true,
}: {
  origin: PresentationOrigin;
  avatarSource?: string;
  notice?: string;
  exitLabel?: string;
  exitDisabled?: boolean;
  onExit?: () => void;
  showSources?: boolean;
}) {
  const [failedAvatarSource, setFailedAvatarSource] = useState<string>();
  // A continuing task needs no persistent status label; terminal states stay
  // meaningful for readers deciding whether a form or card is still usable.
  const state = origin.state === "continuing"
    ? undefined
    : {
        completed: "本次任务已完成",
        unavailable: "当前不可用",
      }[origin.state];
  const roleLine = origin.subtitle ?? `方法：${origin.role}`;
  const avatarInitial = origin.name.trim().charAt(0);
  const resolvedAvatarSource =
    avatarSource && avatarSource !== failedAvatarSource ? avatarSource : undefined;
  return (
    <View className="presentation-origin-header-block">
      {notice && <Text className="presentation-origin-notice">{notice}</Text>}
      <View className="presentation-origin-header">
        <View className="presentation-origin-identity">
          {resolvedAvatarSource ? (
            <Image
              className="presentation-origin-avatar"
              src={resolvedAvatarSource}
              mode="aspectFill"
              ariaLabel={`${origin.name}的头像`}
              onError={() => setFailedAvatarSource(resolvedAvatarSource)}
            />
          ) : (
            <Text
              className="presentation-origin-avatar presentation-origin-avatar-fallback"
            >
              {avatarInitial}
            </Text>
          )}
          <View className="presentation-origin-copy">
            <Text className="presentation-origin-name">AI 专家：{origin.name}</Text>
            <Text className="presentation-origin-role">
              {state ? `${roleLine} · ${state}` : roleLine}
            </Text>
          </View>
        </View>
        {onExit && exitLabel && <Button className="control presentation-origin-exit" disabled={exitDisabled || undefined} onClick={onExit}>{exitLabel}</Button>}
      </View>
      {showSources && (
        <Text className="presentation-origin-sources">
          {origin.sources.length
            ? `实际参考：${origin.sources.map((source) => `${source.library} / ${source.title}（${source.readStatus === "document" ? "已读正文" : "已读片段"}）`).join("；")}`
            : "本轮未使用可核对的知识库正文"}
        </Text>
      )}
    </View>
  );
}

export function PresentationFrame({
  origin,
  avatarSource,
  notice,
  exitLabel,
  exitDisabled,
  onExit,
  showHeader = true,
  showSources = true,
  children,
}: {
  origin: PresentationOrigin;
  avatarSource?: string;
  notice?: string;
  exitLabel?: string;
  exitDisabled?: boolean;
  onExit?: () => void;
  showHeader?: boolean;
  showSources?: boolean;
  children: ReactNode;
}) {
  return (
    <View className={`presentation-frame presentation-theme-${origin.theme} presentation-layout-${origin.layout}`}>
      {showHeader && (
        <PresentationOriginHeader
          origin={origin}
          avatarSource={avatarSource}
          notice={notice}
          exitLabel={exitLabel}
          exitDisabled={exitDisabled}
          onExit={onExit}
          showSources={showSources}
        />
      )}
      <View className="presentation-content">{children}</View>
    </View>
  );
}

export interface ArtifactRendererAdapter<Identity extends string | number> {
  catalogId: string;
  validate(messages: readonly unknown[]): A2uiMessage[];
  compile(
    identity: Identity,
    artifacts: unknown,
    origin?: PresentationOrigin,
  ): A2uiMessage[];
}

type SurfaceProps = ArtifactProps & {
  messages: A2uiMessage[];
  responses: Record<string, FormValues>;
  draftResponses?: Record<string, FormValues>;
  compact?: boolean;
  origin?: PresentationOrigin;
  originNotice?: string;
  originExitLabel?: string;
  onOriginExit?: () => void;
  showOrigin?: boolean;
};
type PresentationSurfaceProps = Pick<
  SurfaceProps,
  | "origin"
  | "originNotice"
  | "originExitLabel"
  | "onOriginExit"
  | "showOrigin"
>;

function isInlineFormSurface(surface: SurfaceModel) {
  return Array.from(surface.componentsModel.entries).some(
    ([, model]) => model.type === "FormField",
  );
}

export function ArtifactSurfaces({
  Host,
  adapter,
  messages,
  responses,
  draftResponses = {},
  compact = true,
  origin,
  originNotice,
  originExitLabel,
  onOriginExit,
  showOrigin = true,
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
  const firstSurfaceId = validated.find((message) => "createSurface" in message)
    ?.createSurface.surfaceId;
  return (
    <Host
      catalogId={adapter.catalogId}
      messages={validated}
      renderSurface={(surface, content) => {
        const confirmedValues = responses[surface.id];
        const inlineForm = isInlineFormSurface(surface);
        const embedded = presentationOriginSchema.safeParse(
          surface.dataModel.get("/origin"),
          { jitless: true },
        );
        const surfaceOrigin = origin ?? (embedded.success ? embedded.data : undefined);
        const contentNode = (
          <ArtifactState
            key={surface.id}
            surface={surface}
            {...props}
            disabledStatus={inlineForm ? props.disabledStatus : undefined}
            submitted={confirmedValues !== undefined}
            confirmedValues={confirmedValues}
            initialDraftValues={draftResponses[surface.id]}
          >
            {inlineForm && confirmedValues !== undefined ? (
              <ArtifactDetails external={props.external}>
                <ConfirmedFormSummary
                  surface={surface}
                  values={confirmedValues}
                  external={props.external}
                />
              </ArtifactDetails>
            ) : compact && !inlineForm ? (
              <ArtifactPreview surface={surface}>
                <ArtifactDetails external={props.external}>
                  {content}
                </ArtifactDetails>
              </ArtifactPreview>
            ) : (
              <ArtifactDetails external={props.external}>{content}</ArtifactDetails>
            )}
          </ArtifactState>
        );
        return surfaceOrigin && showOrigin ? (
          <PresentationFrame
            key={surface.id}
            origin={surfaceOrigin}
            notice={surface.id === firstSurfaceId ? originNotice : undefined}
            exitLabel={surface.id === firstSurfaceId ? originExitLabel : undefined}
            onExit={surface.id === firstSurfaceId ? onOriginExit : undefined}
            showHeader={surface.id === firstSurfaceId}
          >
            {contentNode}
          </PresentationFrame>
        ) : contentNode;
      }}
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
  origin,
  ...props
}: ArtifactProps & PresentationSurfaceProps & {
  config: ArtifactUiConfig;
  Host: ComponentType<ArtifactHostProps>;
  adapter: ArtifactRendererAdapter<Identity>;
  identity: Identity;
  artifacts: unknown;
  origin?: PresentationOrigin;
  responses: Record<string, FormValues>;
  draftResponses?: Record<string, FormValues>;
  compact?: boolean;
}) {
  return (
    <ArtifactUiProvider config={config}>
      <LegacyArtifactsContent
        Host={Host}
        adapter={adapter}
        identity={identity}
        artifacts={artifacts}
        origin={origin}
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
  origin,
  ...props
}: ArtifactProps & PresentationSurfaceProps & {
  Host: ComponentType<ArtifactHostProps>;
  adapter: ArtifactRendererAdapter<Identity>;
  identity: Identity;
  artifacts: unknown;
  origin?: PresentationOrigin;
  responses: Record<string, FormValues>;
  draftResponses?: Record<string, FormValues>;
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
        origin,
      ),
    [adapter, identity, parsed, images.length, origin],
  );
  if (!parsed)
    return <Text className="artifact-error">{labels.unsupported}</Text>;
  return (
    <>
      <ArtifactSurfaces
        Host={Host}
        adapter={adapter}
        messages={messages}
        origin={origin}
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
