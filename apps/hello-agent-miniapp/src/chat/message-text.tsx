import Taro from "@tarojs/taro";
import { useState } from "react";
import { Button, Text, type TextProps } from "@tarojs/components";
import { copyAiReply } from "./api";
import { ChatIcon } from "./icon";

// Taro 的 Text 默认禁止选择；两个属性兼容 H5 和微信不同基础库。
export function MessageText({ aiGenerated = false, external = false, ...props }: TextProps & { aiGenerated?: boolean; external?: boolean }) {
  const nativeAi = aiGenerated && process.env.TARO_ENV === "weapp";
  return <Text {...props} data-ai-generated={aiGenerated ? "true" : "false"} data-ai-external={external ? "true" : "false"} selectable={!nativeAi} userSelect={!nativeAi} onLongPress={nativeAi ? () => {
    if (typeof props.children === "string") void copyAiReply(props.children, external).catch(() => Taro.showToast({ title: "复制失败，请重试", icon: "none" }));
  } : props.onLongPress} />;
}

export function CopyMessage({
  value,
  label,
  external = false,
}: {
  value: string;
  label: string;
  external?: boolean;
}) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  const actionLabel = state === "copied" ? "已复制" : state === "failed" ? "复制失败，重试" : label;
  return (
    <Button
      className="control message-action message-copy"
      aria-label={actionLabel}
      onLongPress={() => void Taro.showToast({ title: actionLabel, icon: "none" })}
      onClick={async () => {
        try {
          await copyAiReply(value, external);
          setState("copied");
        } catch {
          setState("failed");
          void Taro.showToast({ title: "复制失败，请重试", icon: "none" });
        }
      }}
    >
      <ChatIcon name={state === "copied" ? "check" : "copy"} />
    </Button>
  );
}
