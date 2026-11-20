import { z } from "zod";
import { AppError } from "../contracts";
import type { ChatProvider, ProviderInput, ProviderOutput } from "./contracts";

interface OpenAIChatProviderOptions {
  apiKey: string; model: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number;
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
  constructor(private readonly options: OpenAIChatProviderOptions) {
    if (!options.apiKey.trim() || !/^[\x21-\x7e]+$/.test(options.apiKey.trim()) || !options.model.trim()) throw new AppError(503, "CHAT_PROVIDER_NOT_CONFIGURED", "对话模型尚未配置，请稍后再试。");
    this.endpoint = new URL(`${(options.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")}/chat/completions`);
    if (this.endpoint.username || this.endpoint.password || this.endpoint.search || this.endpoint.hash || (this.endpoint.protocol !== "https:" && !(this.endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(this.endpoint.hostname)))) throw new AppError(503, "CHAT_PROVIDER_CONFIG_INVALID", "对话模型地址配置无效。");
  }
  async complete(input: ProviderInput): Promise<ProviderOutput> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 45_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      const response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: "POST", redirect: "error", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.options.apiKey.trim()}` },
        body: JSON.stringify({
          model: this.options.model, stream: false, max_completion_tokens: 4000,
          messages: [{ role: "system", content: input.instructions }, ...input.messages.map(message => ({
            role: message.role, content: message.content,
            ...(message.toolCalls ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
            ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          }))],
          tools: input.tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
          tool_choice: "auto", parallel_tool_calls: false,
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
  return new OpenAIChatProvider({ apiKey: env.BUBU_CHAT_API_KEY, model: env.BUBU_CHAT_MODEL, baseUrl: env.BUBU_CHAT_BASE_URL });
}
