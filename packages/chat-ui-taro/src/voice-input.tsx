import { useEffect, useRef, useState } from "react";
import { Button, Text, View } from "./taro-components";
import {
  createSpeechSession,
  type SpeechDriver,
  type SpeechPhase,
} from "./speech";

export interface VoiceInputCopy {
  idle: string;
  starting: string;
  listening: string;
  transcribing: string;
  cancelling: string;
  privacy: string;
  cancelRecording: string;
}

const defaultVoiceCopy: VoiceInputCopy = {
  idle: "按住说话",
  starting: "正在打开麦克风…",
  listening: "松开，转成文字",
  transcribing: "正在听清你的话…",
  cancelling: "正在取消…",
  privacy: "语音会转成文字，确认后发送",
  cancelRecording: "取消这次录音",
};

export interface VoiceInputProps {
  disabled: boolean;
  onText(text: string): void;
  onActiveChange(active: boolean): void;
  createDriver(): SpeechDriver;
  subscribeAppHide?(listener: () => void): () => void;
  copy?: Partial<VoiceInputCopy>;
}

export function VoiceInput({
  disabled,
  onText,
  onActiveChange,
  createDriver,
  subscribeAppHide,
  copy,
}: VoiceInputProps) {
  const labels = { ...defaultVoiceCopy, ...copy };
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
    const current = createSpeechSession(createDriver(), {
      phase: setPhase,
      result: (text) => result.current(text),
      error: setError,
    });
    session.current = current;
    const hide = () => current.cancel();
    const unsubscribeHide =
      process.env.TARO_ENV === "weapp" ? subscribeAppHide?.(hide) : undefined;
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
      unsubscribeHide?.();
      if (process.env.TARO_ENV === "h5" && typeof window !== "undefined") {
        window.removeEventListener("blur", blur);
        document.removeEventListener("visibilitychange", visibility);
      }
    };
  }, [createDriver, subscribeAppHide]);

  useEffect(() => {
    if (disabled) session.current?.cancel();
  }, [disabled]);

  const start = () => {
    if (disabled || phase !== "idle") return;
    setError("");
    session.current?.start();
  };
  const stop = () => session.current?.stop();

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
        <Text>{labels[phase]}</Text>
      </Button>
      {(phase !== "idle" || error) && (
        <View className="voice-feedback">
          {phase !== "idle" && (
            <>
              <Text className="voice-privacy">{labels.privacy}</Text>
              <Button
                className="control voice-cancel"
                onClick={() => session.current?.cancel()}
              >
                {labels.cancelRecording}
              </Button>
            </>
          )}
          {error && <Text className="voice-error">{error}</Text>}
        </View>
      )}
    </View>
  );
}
