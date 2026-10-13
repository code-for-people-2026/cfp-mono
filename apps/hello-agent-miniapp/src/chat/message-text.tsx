import Taro from "@tarojs/taro";
import { useState } from "react";
import { Button, Text, type TextProps } from "@tarojs/components";
import { copyAiReply } from "./api";
import { ChatIcon } from "./icon";

// Taro 的 Text 默认禁止选择；两个属性兼容 H5 和微信不同基础库。
export function MessageText({ aiGenerated = false, external = false, ...props }: TextProps & { aiGenerated?: boolean; external?: boolean }) {
  const nativeAi = aiGenerated && process.env.TARO_ENV === "weapp";
  return <Text {...props} selectable={!nativeAi} userSelect={!nativeAi} onLongPress={nativeAi ? () => {
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
  return (
    <Button
      className="control message-copy"
      aria-label={label}
      onClick={async () => {
        try {
          await copyAiReply(value, external);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
    >
      <ChatIcon name="copy" />
      <Text>
        {state === "copied"
          ? "已复制"
          : state === "failed"
            ? "复制失败，重试"
            : "复制"}
      </Text>
    </Button>
  );
}
