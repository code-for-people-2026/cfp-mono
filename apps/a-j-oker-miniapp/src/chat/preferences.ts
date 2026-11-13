import { useSyncExternalStore } from "react";
import type { Mode } from "./model";

// 页面栈内共享连接方式；不持久化草稿、模型密钥或 MCP 令牌。
let mode: Mode = "platform";
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function selectChatMode(value: Mode) {
  if (value !== "platform" || mode === value) return;
  mode = value;
  listeners.forEach((listener) => listener());
}
export function useChatMode() {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => mode,
  );
}
