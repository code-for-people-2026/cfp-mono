import { z } from "zod";
import { AppError } from "../contracts";
import type { ChatProvider, ProviderInput, ProviderOutput } from "./contracts";

interface OpenAIChatProviderOptions {
  apiKey: string; model: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number;
  structuredOutputMode?: "json_schema" | "json_object";
}
const completionSchema = z.object({ choices: z.array(z.object({
  finish_reason: z.enum(["stop", "tool_calls"]),
  message: z.object({ content: z.string().max(16000).nullable().optional(), tool_calls: z.array(z.object({
    id: z.string().min(1).max(200), type: z.literal("function"),
    function: z.object({ name: z.string().min(1).max(100), arguments: z.string().max(100000) }),
  })).max(8).optional() }),
})).min(1).max(1) });

export class OpenAIChatProvider implements ChatProvider {
  private readonly endpoint: URL;
  private readonly structuredOutputMode: "json_schema" | "json_object";
  constructor(private readonly options: OpenAIChatProviderOptions) {
    if (!options.apiKey.trim() || !/^[\x21-\x7e]+$/.test(options.apiKey.trim()) || !options.model.trim()) throw new AppError(503, "CHAT_PROVIDER_NOT_CONFIGURED", "对话模型尚未配置，请稍后再试。");
    this.endpoint = new URL(`${(options.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`);
    if (this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash || (this.endpoint.protocol !== "https:" && !(this.endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(this.endpoint.hostname)))) throw new AppError(503, "CHAT_PROVIDER_CONFIG_INVALID", "对话模型地址配置无效。");
    const inferred = this.endpoint.hostname === "api.openai.com" ? "json_schema"
      : this.endpoint.hostname === "api.deepseek.com" ? "json_object" : undefined;
    if (!options.structuredOutputMode && !inferred) throw new AppError(503, "CHAT_PROVIDER_CONFIG_INVALID", "自定义对话模型地址必须明确配置结构化输出模式。");
    this.structuredOutputMode = options.structuredOutputMode ?? inferred!;
  }
  async complete(input: ProviderInput): Promise<ProviderOutput> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 45_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      const response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey.trim()}` },
        body: JSON.stringify({
          model: this.options.model, stream: false,
          ...(this.endpoint.hostname === "api.deepseek.com" ? { max_tokens: input.tools.length ? 4000 : 1200 } : { max_completion_tokens: 4000 }),
          // DeepSeek thinking mode requires reasoning_content to be replayed on
          // every following tool request. This adapter intentionally stores only
          // the portable Chat Completions transcript, so keep thinking disabled
          // for the whole DeepSeek tool loop rather than producing an invalid
          // second request.
          ...(this.endpoint.hostname === "api.deepseek.com" ? { thinking: { type: "disabled" } } : {}),
          messages: [{ role: "system", content: input.responseFormat && this.structuredOutputMode === "json_object"
            ? `${input.instructions}\n必须只返回一个 JSON 对象，并在本地严格按以下 schema 校验；不得输出 Markdown：${JSON.stringify(input.responseFormat.schema)}`
            : input.instructions }, ...input.messages.map(message => ({
            role: message.role, content: message.content,
            ...(message.toolCalls ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          }))],
          ...(input.tools.length ? {
            tools: input.tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
            tool_choice: "auto", parallel_tool_calls: false,
          } : {}),
          ...(input.responseFormat ? this.structuredOutputMode === "json_object"
            ? { response_format: { type: "json_object" } }
            : { response_format: { type: "json_schema", json_schema: { name: input.responseFormat.name, strict: input.responseFormat.strict ?? true, schema: input.responseFormat.schema } } } : {}),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new AppError(502, "CHAT_PROVIDER_UNAVAILABLE", `对话模型请求未完成（HTTP ${response.status}），可以用原请求重试。`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Empty provider response");
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength;
          if (length > 2 * 1024 * 1024) throw new Error("Provider response limit");
          chunks.push(part.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const parsed = completionSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const message = parsed.choices[0]!.message;
      const calls = (message.tool_calls || []).map(call => {
        if (!input.tools.some(tool => tool.name === call.function.name)) throw new Error("Unregistered provider tool");
        return { id: call.id, name: call.function.name, arguments: z.record(z.string(), z.unknown()).parse(JSON.parse(call.function.arguments)) };
      });
      if (new Set(calls.map(call => call.id)).size !== calls.length || (!calls.length && !message.content?.trim())) throw new Error("Invalid provider completion");
      return { text: message.content?.trim() || "", calls };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Never retain provider response bodies, original exceptions, or credentials.
      throw new AppError(502, signal.aborted ? "CHAT_PROVIDER_TIMEOUT" : "CHAT_PROVIDER_RESPONSE_INVALID", signal.aborted ? "对话暂时超时，已保存输入，可以继续处理。" : "对话模型暂时无法完成，已保存输入，可以重试。");
    }
  }
}

/** No environment switch can enable a fake provider. Missing configuration keeps the rest of the app available. */
export function chatProviderFromEnv(env: Record<string, string | undefined> = process.env): ChatProvider | undefined {
  if (!env.BUBU_CHAT_API_KEY?.trim() || !env.BUBU_CHAT_MODEL?.trim()) return undefined;
  const configuredMode = env.BUBU_CHAT_STRUCTURED_OUTPUT_MODE;
  if (configuredMode && configuredMode !== "json_schema" && configuredMode !== "json_object") throw new AppError(503, "CHAT_PROVIDER_CONFIG_INVALID", "结构化输出模式配置无效。");
  return new OpenAIChatProvider({ apiKey: env.BUBU_CHAT_API_KEY, model: env.BUBU_CHAT_MODEL, baseUrl: env.BUBU_CHAT_BASE_URL,
    ...(configuredMode ? { structuredOutputMode: configuredMode as "json_schema" | "json_object" } : {}) });
}
