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
  temperature?: number;
  response_format?: { type: "json_object" };
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

export type DeepSeekDiagnostic = {
  responseStage?: "response_json" | "response_schema" | "envelope";
  schemaPath?: string;
  timeout: boolean;
  transportCode?: string;
  transportName?: string;
};

// Keep only a safe classification and HTTP status. Never retain provider bodies,
// request headers, credentials, or an original exception as a cause.
export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly kind: "credential" | "http" | "transport" | "response",
    readonly status?: number,
    readonly diagnostic: DeepSeekDiagnostic = { timeout: false },
  ) {
    super(message);
  }
}

const safeTransportCodes = new Set([
  "ECONNABORTED",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);
const safeTransportNames = new Set(["AbortError", "TimeoutError", "TypeError"]);
const timeoutTransportCodes = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

function safeSchemaPath(error: z.ZodError): string | undefined {
  for (const issue of error.issues) {
    const path = issue.path
      .map((segment) => (typeof segment === "number" ? `[${segment}]` : String(segment)))
      .join(".");
    if (path && /^[A-Za-z0-9_[\].-]{1,80}$/.test(path)) return path;
  }
  return undefined;
}

function safeTransportDiagnostic(error: unknown): DeepSeekDiagnostic {
  let transportCode: string | undefined;
  let transportName: string | undefined;
  let sawTimeoutName = false;
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const code = "code" in current
      ? (current as { code?: unknown }).code
      : undefined;
    if (!transportCode && typeof code === "string" && safeTransportCodes.has(code))
      transportCode = code;
    if (!transportName && safeTransportNames.has(current.name))
      transportName = current.name;
    if (current.name === "TimeoutError") sawTimeoutName = true;
    current = (current as { cause?: unknown }).cause;
  }
  return {
    timeout:
      sawTimeoutName
      || (transportCode !== undefined && timeoutTransportCodes.has(transportCode)),
    ...(transportCode ? { transportCode } : {}),
    ...(transportName ? { transportName } : {}),
  };
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
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw new DeepSeekError(
          "DeepSeek 请求未完成，请检查网络或稍后重试",
          "transport",
          undefined,
          safeTransportDiagnostic(error),
        );
      }
      throw new DeepSeekError("DeepSeek 响应格式不符合约定", "response", undefined, {
        responseStage: "response_json",
        timeout: false,
      });
    }
    const parsed = completionSchema.safeParse(body);
    if (!parsed.success)
      throw new DeepSeekError("DeepSeek 响应格式不符合约定", "response", undefined, {
        responseStage: parsed.success ? "envelope" : "response_schema",
        ...(safeSchemaPath(parsed.error) ? { schemaPath: safeSchemaPath(parsed.error) } : {}),
        timeout: false,
      });
    return parsed.data;
  } catch (error) {
    if (error instanceof DeepSeekError) throw error;
    throw new DeepSeekError(
      "DeepSeek 请求未完成，请检查网络或稍后重试",
      "transport",
      undefined,
      safeTransportDiagnostic(error),
    );
  }
}
