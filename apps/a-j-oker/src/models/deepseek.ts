import { z } from "zod";

export const DEFAULT_MODEL = "deepseek-flash";
export const jsonObjectSchema = z.record(z.string(), z.json());
export type JsonObject = z.output<typeof jsonObjectSchema>;

export type ModelContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type ModelTool = {
  type: "function";
  function: { name: string; description?: string; parameters: JsonObject };
};
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ModelContent[] | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};
export type ModelRequest = {
  model: string;
  messages: ModelMessage[];
  tools: ModelTool[];
  tool_choice:
    | "auto"
    | "none"
    | "required"
    | {
        type: "function";
        function: { name: string };
      };
  max_tokens: number;
};
const completionSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .optional(),
});

export function normalizedDeepSeekKey(value: string | undefined) {
  const key = value?.trim();
  return key && /^[\x21-\x7E]+$/.test(key) ? key : undefined;
}

// Keep only a safe classification and HTTP status. Never retain provider bodies,
// request headers, credentials, or an original exception as a cause.
export class DeepSeekError extends Error {
  constructor(message: string, readonly kind: "credential" | "http" | "transport" | "response", readonly status?: number) {
    super(message);
  }
}

// 平台适配器和独立客户端共用协议层；这里不导入 ADK、CMS 或业务服务。
// 固定官方端点，禁止重定向携带密钥；不记录请求头、响应原文或隐藏推理。
export async function completeDeepSeek(
  request: ModelRequest,
  apiKey: string,
  signal?: AbortSignal,
) {
  const key = normalizedDeepSeekKey(apiKey);
  if (!key) throw new DeepSeekError("DeepSeek 密钥配置无效", "credential");
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        ...request,
        thinking: { type: "disabled" },
        stream: false,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new DeepSeekError(`DeepSeek 请求失败（HTTP ${response.status}）`, "http", response.status);
    }
    const parsed = completionSchema.safeParse(await response.json());
    if (!parsed.success) throw new DeepSeekError("DeepSeek 响应格式不符合约定", "response");
    return parsed.data;
  } catch (error) {
    if (error instanceof DeepSeekError) throw error;
    throw new DeepSeekError("DeepSeek 请求未完成，请检查网络或稍后重试", "transport");
  }
}
