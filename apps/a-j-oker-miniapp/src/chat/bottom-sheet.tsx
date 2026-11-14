import type { ComponentProps } from "react";
import {
  ArtifactUiProvider,
  BottomSheet as SharedBottomSheet,
  useSheetFieldFocus,
} from "@cfp/chat-ui-taro/artifacts";
import { artifactUiConfig } from "./artifact-components";

export function BottomSheet(
  props: ComponentProps<typeof SharedBottomSheet>,
) {
  return (
    <ArtifactUiProvider config={artifactUiConfig}>
      <SharedBottomSheet {...props} />
    </ArtifactUiProvider>
  );
}

export { useSheetFieldFocus };
