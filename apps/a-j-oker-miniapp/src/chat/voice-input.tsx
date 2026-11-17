import type { ComponentProps } from "react";
import Taro from "@tarojs/taro";
import { VoiceInput as SharedVoiceInput } from "@cfp/chat-ui-taro";
import { createPlatformSpeechDriver } from "./speech-platform";

type VoiceInputProps = Omit<
  ComponentProps<typeof SharedVoiceInput>,
  "createDriver"
>;

const providerName =
  process.env.TARO_ENV === "h5" ? "浏览器语音服务" : "微信同声传译";

function subscribeAppHide(listener: () => void) {
  Taro.onAppHide(listener);
  return () => Taro.offAppHide(listener);
}

export function VoiceInput(props: VoiceInputProps) {
  return (
    <SharedVoiceInput
      {...props}
      createDriver={createPlatformSpeechDriver}
      subscribeAppHide={subscribeAppHide}
      copy={{
        privacy: `语音由${providerName}识别，转文字后确认发送`,
      }}
    />
  );
}
