import type { ReactNode } from "react";
import { Text } from "@tarojs/components";
import {
  ChatComposer as SharedChatComposer,
  type ChatComposerIconName,
  type ChatComposerProps,
} from "@cfp/chat-ui-taro";
import { ChatIcon } from "./icon";
import { VoiceInput } from "./voice-input";

export type {
  ChatComposerAttachment,
  ImageSource,
  InputMode,
} from "@cfp/chat-ui-taro";

const providerName =
  process.env.TARO_ENV === "h5" ? "浏览器语音服务" : "微信同声传译";

function renderIcon(
  name: ChatComposerIconName,
  options?: { inverted?: boolean },
): ReactNode {
  return <ChatIcon name={name} inverted={options?.inverted} />;
}

export function ChatComposer(
  props: Omit<
    ChatComposerProps<number>,
    | "placeholder"
    | "maxTextLength"
    | "maxAttachments"
    | "attachmentLimit"
    | "voicePrivacy"
    | "renderIcon"
    | "voiceInput"
  >,
) {
  return (
    <SharedChatComposer
      {...props}
      placeholder="发消息，聊聊你的烦心事…"
      maxTextLength={4000}
      maxAttachments={3}
      attachmentLimit="最多 3 张图片"
      voicePrivacy={
        <Text className="voice-privacy">
          语音由{providerName}识别，转成文字后由你确认发送
        </Text>
      }
      renderIcon={renderIcon}
      voiceInput={(voiceProps) => <VoiceInput {...voiceProps} />}
    />
  );
}
