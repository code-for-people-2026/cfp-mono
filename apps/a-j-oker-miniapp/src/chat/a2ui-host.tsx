import { AJ_CATALOG_ID } from "@cfp/a-j-oker-contracts";
import { NativeA2uiHost } from "@cfp/chat-ui-taro/a2ui-native";
import type { HostProps } from "./a2ui-feed";

export function A2uiHost(props: HostProps) {
  return <NativeA2uiHost {...props} catalogId={AJ_CATALOG_ID} />;
}
