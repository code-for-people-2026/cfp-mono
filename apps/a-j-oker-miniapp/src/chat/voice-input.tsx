import { useEffect, useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { createSpeechSession, type SpeechPhase } from "./speech";
import { createPlatformSpeechDriver } from "./speech-platform";

export function VoiceInput({
  disabled,
  onText,
  onActiveChange,
}: {
  disabled: boolean;
  onText(text: string): void;
  onActiveChange(active: boolean): void;
}) {
  const [phase, setPhase] = useState<SpeechPhase>("idle");
  const [error, setError] = useState("");
  const session = useRef<ReturnType<typeof createSpeechSession>>();
  const lastTouch = useRef(0);
  const result = useRef(onText);
  result.current = onText;
  useEffect(() => {
    onActiveChange(phase !== "idle");
    return () => onActiveChange(false);
  }, [phase, onActiveChange]);
  useEffect(() => {
    const current = createSpeechSession(createPlatformSpeechDriver(), {
      phase: setPhase,
      result: (text) => result.current(text),
      error: setError,
    });
    session.current = current;
    const hide = () => current.cancel();
    if (process.env.TARO_ENV === "weapp") Taro.onAppHide(hide);
    const blur = () => current.cancel();
    const visibility = () => {
      if (document.hidden) current.cancel();
    };
    if (process.env.TARO_ENV === "h5" && typeof window !== "undefined") {
      window.addEventListener("blur", blur);
      document.addEventListener("visibilitychange", visibility);
    }
    return () => {
      current.dispose();
      if (process.env.TARO_ENV === "weapp") Taro.offAppHide(hide);
      if (process.env.TARO_ENV === "h5" && typeof window !== "undefined") {
        window.removeEventListener("blur", blur);
        document.removeEventListener("visibilitychange", visibility);
      }
    };
  }, []);
  useEffect(() => {
    if (disabled) session.current?.cancel();
  }, [disabled]);
  const start = () => {
    if (disabled || phase !== "idle") return;
    setError("");
    session.current?.start();
  };
  const stop = () => session.current?.stop();
  const label = {
    idle: "按住说话",
    starting: "正在打开麦克风…",
    listening: "松开，转成文字",
    transcribing: "正在听清你的话…",
    cancelling: "正在取消…",
  }[phase];
  return (
    <View className="voice-input">
      <Button
        className={`control voice-hold voice-${phase}`}
        disabled={disabled || undefined}
        onTouchStart={() => {
          lastTouch.current = Date.now();
          start();
        }}
        onTouchEnd={stop}
        onTouchCancel={() => session.current?.cancel()}
        {...(process.env.TARO_ENV === "h5"
          ? {
              onMouseDown: () => {
                if (Date.now() - lastTouch.current > 750) start();
              },
              onMouseUp: stop,
              onMouseLeave: stop,
              onKeyDown: (event: { key: string; preventDefault(): void }) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  start();
                }
              },
              onKeyUp: (event: { key: string; preventDefault(): void }) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  stop();
                }
              },
            }
          : {})}
      >
        <Text>{label}</Text>
      </Button>
      {(phase !== "idle" || error) && (
        <View className="voice-feedback">
          {phase !== "idle" && (
            <>
              <Text className="voice-privacy">
                语音由
                {process.env.TARO_ENV === "h5"
                  ? "浏览器语音服务"
                  : "微信同声传译"}
                识别，转文字后确认发送
              </Text>
              <Button
                className="control voice-cancel"
                onClick={() => session.current?.cancel()}
              >
                取消这次录音
              </Button>
            </>
          )}
          {error && <Text className="voice-error">{error}</Text>}
        </View>
      )}
    </View>
  );
}
