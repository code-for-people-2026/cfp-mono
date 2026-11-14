import type { ComponentProps } from "react";
import {
  Artifacts as SharedArtifacts,
  LiveArtifacts as SharedLiveArtifacts,
  type ArtifactRendererAdapter,
} from "@cfp/chat-ui-taro/artifacts";
import { AJ_CATALOG_ID, toAjA2ui, validateAjA2uiMessages } from "@cfp/a-j-oker-contracts";
import type { A2uiMessage } from "@cfp/base-chat-protocol";
import { A2uiHost } from "./a2ui-host";
import { artifactUiConfig } from "./artifact-components";

const adapter: ArtifactRendererAdapter<number> = {
  catalogId: AJ_CATALOG_ID,
  compile: (turnId, artifacts) => toAjA2ui(turnId, artifacts),
  validate: validateAjA2uiMessages,
};

export function LiveArtifacts({ messages }: { messages: A2uiMessage[] }) {
  return (
    <SharedLiveArtifacts
      config={artifactUiConfig}
      Host={A2uiHost}
      adapter={adapter}
      messages={messages}
    />
  );
}

type SharedProps = Omit<
  ComponentProps<typeof SharedArtifacts<number>>,
  "config" | "Host" | "adapter" | "identity"
>;

export function Artifacts({ turnId, ...props }: SharedProps & { turnId: number }) {
  return (
    <SharedArtifacts
      {...props}
      config={artifactUiConfig}
      Host={A2uiHost}
      adapter={adapter}
      identity={turnId}
    />
  );
}
