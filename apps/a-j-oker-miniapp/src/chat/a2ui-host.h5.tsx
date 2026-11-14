import { AJ_CATALOG_ID } from "@cfp/a-j-oker-contracts";
import { H5A2uiHost } from "@cfp/chat-ui-taro/a2ui-h5";
import type { HostProps } from "./a2ui-feed";

export function A2uiHost(props: HostProps) {
  return <H5A2uiHost {...props} catalogId={AJ_CATALOG_ID} />;
}
