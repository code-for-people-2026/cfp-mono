export type Mode = "platform" | "byok" | "external";
export type Session = { id: number; title: string };
export type Input = { text: string; mediaIds: number[] };
export type Turn = {
  id: number;
  input: Input;
  status: "running" | "completed" | "failed";
  mode: Mode;
  greeting?: string;
  association?: string;
  model: string;
  createdAt: string;
};
export type Settings = {
  platformConfigured: boolean;
  model: string;
  origin: string;
  advertisement: Advertisement;
};
export type Advertisement = {
  mode: "demo" | "wechat" | "disabled";
  adUnitId: string;
  demoSeconds: number;
};
export type MemoryStatus = {
  usedTokens: number;
  budgetTokens: number;
  remainingPercent: number;
  level: string;
  canCompact: boolean;
  candidateCount: number;
  recentTurns: number;
  compressions: number;
  summary: string;
  rewardReady: boolean;
  advertisement: Advertisement;
};
export type AdTicket = Advertisement & { rewardId: string; completed: boolean };
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
    detail: "我们的 ADK · 平台模型账户",
    icon: "✦",
  },
  {
    id: "byok",
    label: "我的密钥",
    detail: "我们的 ADK · 你的 DeepSeek 账户",
    icon: "⌘",
  },
  {
    id: "external",
    label: "自带 Agent",
    detail: "你的助手 · 通过 MCP 保存",
    icon: "↗",
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
    !!(text.trim() || attachments.length) &&
    mode !== "external" &&
    (mode === "platform" ? configured : key.trim().length >= 10)
  );
}
// 这是幂等标识，不是身份凭证；身份令牌由服务端使用安全随机数生成。
export function requestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
