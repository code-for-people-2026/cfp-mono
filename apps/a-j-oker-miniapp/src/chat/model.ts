import type { Mode } from "@cfp/a-j-oker-contracts";
export type {
  Mode,
  Session,
  Inspiration as Input,
  Turn,
  Settings,
  MemoryStatus,
  Advertisement,
  AdTicket,
} from "@cfp/a-j-oker-contracts";
export type Attachment = { id: number; src: string };
export const modes: {
  id: Mode;
  label: string;
  detail: string;
  icon: string;
}[] = [
  {
    id: "platform",
    label: "平台助手",
    detail: "直接开始聊天，由平台提供模型",
    icon: "✦",
  },

];
export function canSend(
  text: string,
  attachments: Attachment[],
  mode: Mode,
  key: string,
  configured: boolean,
  busy: boolean,
) {
  return (
    !busy &&
    text.trim().length <= 4000 &&
    !!(text.trim() || attachments.length) &&
    mode === "platform" &&
    !key &&
    configured
  );
}
// 这是幂等标识，不是身份凭证；身份令牌由服务端使用安全随机数生成。
export function requestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
