import type { ArtifactHostProps } from "@cfp/chat-ui-taro/artifacts";

export type HostProps = Omit<ArtifactHostProps, "catalogId">;
export {
  coreMessages,
  surfaceIds,
  useMessageFeed,
} from "@cfp/chat-ui-taro/artifacts";
