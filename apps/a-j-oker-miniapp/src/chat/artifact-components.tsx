import type { ComponentProps } from "react";
import Taro from "@tarojs/taro";
import {
  ArtifactComponent,
  ArtifactImage as SharedArtifactImage,
  ArtifactState as SharedArtifactState,
  ArtifactUiProvider,
  tableCellText,
  useArtifactState,
  type ArtifactProps,
  type ArtifactUiConfig,
} from "@cfp/chat-ui-taro/artifacts";
import { privateImageSource, copyAiReply } from "./api";
import { MessageText } from "./message-text";
import { ChatIcon } from "./icon";
import { SheetPortal } from "./sheet-portal";

export const artifactUiConfig: ArtifactUiConfig = {
  Text: MessageText,
  Portal: SheetPortal,
  resolveResource: privateImageSource,
  previewImage: (source) => {
    void Taro.previewImage({ urls: [source], current: source });
  },
  openPage: (url) => {
    if (process.env.TARO_ENV === "h5") window.location.assign(url);
  },
  copyText: (value, external) => copyAiReply(value, external),
  notify: (message) => {
    void Taro.showToast({ title: message, icon: "none" });
  },
  renderIcon: (name) => <ChatIcon name={name} />,
  nativeSheet: {
    getWindowHeight: () => Taro.getWindowInfo().windowHeight,
    onKeyboardHeightChange: (listener) => Taro.onKeyboardHeightChange(listener),
    offKeyboardHeightChange: (listener) => Taro.offKeyboardHeightChange(listener),
    onWindowResize: (listener) => Taro.onWindowResize(listener),
    offWindowResize: (listener) => Taro.offWindowResize(listener),
  },
  copy: { submitted: "已提交，阿 J 先生已接着回应" },
};

export function ArtifactState(
  props: ComponentProps<typeof SharedArtifactState>,
) {
  return (
    <ArtifactUiProvider config={artifactUiConfig}>
      <SharedArtifactState {...props} />
    </ArtifactUiProvider>
  );
}

export function ArtifactImage(
  props: ComponentProps<typeof SharedArtifactImage>,
) {
  return (
    <ArtifactUiProvider config={artifactUiConfig}>
      <SharedArtifactImage {...props} />
    </ArtifactUiProvider>
  );
}

export {
  ArtifactComponent,
  tableCellText,
  useArtifactState,
  type ArtifactProps,
};
