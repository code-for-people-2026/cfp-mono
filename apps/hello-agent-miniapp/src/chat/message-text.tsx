import { useState } from "react";
import { Button, Text, type TextProps } from "@tarojs/components";
import { copy } from "./api";
import { ChatIcon } from "./icon";

// Taro 的 Text 默认禁止选择；两个属性兼容 H5 和微信不同基础库。
export function MessageText(props: TextProps) {
  return <Text {...props} selectable userSelect />;
}

export function CopyMessage({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [state, setState] = useState<"ready" | "copied" | "failed">("ready");
  return (
    <Button
      className="control message-copy"
      aria-label={label}
      onClick={async () => {
        try {
          await copy(value);
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
