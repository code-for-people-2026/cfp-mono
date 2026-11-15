import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { AppError } from "../contracts";
import type { ProviderTool } from "./contracts";

export const readTools = new Set(["bubu_query_events", "bubu_get_summary", "bubu_get_pending", "bubu_get_revisions", "bubu_get_rules"]);
export const mutationTools = new Set(["bubu_record_events", "bubu_update_event", "bubu_retract_event", "bubu_restore_event", "bubu_undo_event", "bubu_answer_pending", "bubu_attach_images", "bubu_resolve_media", "bubu_resolve_duplicate", "bubu_confirm_overlap", "bubu_accept_legacy"]);
export class McpToolError extends AppError {
  constructor(code: string, message: string, readonly retryable: boolean, status?: number) { super(status ?? (retryable ? 503 : code === "REQUEST_NOT_FOUND" ? 404 : 409), code, message, retryable); }
}
const resultSchema = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).optional() }).passthrough();

/** The delegated token exists only in this transport closure, never in model messages or persisted state. */
export class ChatMcpClient {
  private readonly client = new Client({ name: "bubu-inapp-chat", version: "1.0.0" });
  readonly url: URL;
  constructor(url: string | URL, private readonly token: string, private readonly requestFetch: typeof fetch = fetch, private readonly signal?: AbortSignal) {
    this.url = new URL(url);
    if (this.url.username || this.url.password || (this.url.protocol !== "https:" && !(this.url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(this.url.hostname)))) throw new AppError(503, "CHAT_MCP_CONFIG_INVALID", "记录服务地址配置无效。");
  }
  async connect() {
    await this.client.connect(new StreamableHTTPClientTransport(this.url, { fetch: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.delete("Cookie"); headers.set("Authorization", `Bearer ${this.token}`); headers.set("X-Bubu-Client", "native");
      const signals = [this.signal, init?.signal ?? undefined, AbortSignal.timeout(30_000)].filter((value): value is AbortSignal => !!value);
      const response = await this.requestFetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.any(signals) });
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        throw new AppError(response.status, response.status === 401 ? "UNAUTHORIZED" : "BABY_FORBIDDEN", "登录或宝宝授权已变化，请重新打开对话。");
      }
      return response;
    } }));
  }
  async tools(): Promise<ProviderTool[]> {
    return (await this.client.listTools()).tools.filter(tool => readTools.has(tool.name) || mutationTools.has(tool.name)).map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
  }
  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = resultSchema.parse(await this.client.callTool({ name, arguments: args }, undefined, { timeout: 60_000, signal: this.signal }));
    const text = result.content?.find(item => item.type === "text")?.text;
    let value: unknown;
    try { value = result.structuredContent ?? (text ? JSON.parse(text) : undefined); } catch { throw new AppError(502, "CHAT_MCP_RESPONSE_INVALID", "记录服务回执格式无效，请使用原请求恢复。"); }
    if (result.isError) {
      const failure = z.object({ code: z.string(), error: z.string(), retryable: z.boolean(), status: z.number().int().min(400).max(599).optional() }).safeParse(value);
      if (failure.success) throw new McpToolError(failure.data.code, failure.data.error, failure.data.retryable, failure.data.status);
      throw new McpToolError("CHAT_MCP_UNAVAILABLE", "记录服务暂不可用，请使用原请求恢复。", true);
    }
    if (value === undefined) throw new McpToolError("CHAT_MCP_RESPONSE_INVALID", "记录服务未确认结果，请使用原请求恢复。", true);
    return value;
  }
  async close() { await this.client.close(); }
}
