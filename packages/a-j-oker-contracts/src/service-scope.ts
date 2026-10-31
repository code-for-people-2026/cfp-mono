// 首版申报范围固定为平台 DeepSeek + 万相；历史记录仍保留原模式。
export const SERVICE_SCOPE = {
  modes: ["platform"],
  byok: false,
  externalAgent: false,
} as const;
export const PLATFORM_ONLY_NOTICE = "当前仅开放平台 DeepSeek 和万相，不支持自带密钥或外部 Agent 连接";

export function platformInputAllowed(value: unknown) {
  if (!value || typeof value !== "object") return true; // 格式错误交给协议校验。
  const input = value as { mode?: unknown; apiKey?: unknown };
  return (input.mode === undefined || input.mode === "platform") && input.apiKey === undefined;
}
