/**
 * DeepSeek chat with native function-calling (OpenAI-compatible `tools` param). This
 * is the mechanism the 「今天」agent loop drives — NOT `response_format` (which DeepSeek
 * rejects, cf. PR2's generateObject finding). DeepSeek returns `tool_calls` reliably
 * (spiked: extracts structured args from free-form 接龙/口述).
 *
 * Pure-ish (fetch at the boundary, injected for tests). Returns the assistant message's
 * text content + any tool calls; the agent loop executes the tools + re-loops.
 */
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

/** OpenAI-style chat message (system/user/assistant/tool). */
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant messages carry the tool calls they made. */
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  /** tool messages carry the id of the call they answer. */
  tool_call_id?: string;
};

export type ChatResult = { content: string | null; toolCalls: ToolCall[] };

type ChatDeps = { fetch?: typeof fetch };

/** Call DeepSeek with messages (+ optional tools). Resolves content + parsed tool calls. */
export async function chatWithTools(
  input: { messages: ChatMessage[]; tools?: ToolDef[] },
  deps: ChatDeps = {},
): Promise<ChatResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const fetchImpl = deps.fetch ?? fetch;

  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      // non-thinking model (deepseek-v4-flash is a thinking model — empty content).
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      messages: input.messages,
      ...(input.tools && input.tools.length > 0 ? { tools: input.tools, tool_choice: "auto" } : {}),
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DeepSeek chat failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatMessage["tool_calls"] }; finish_reason?: string }>;
  };
  const msg = data.choices?.[0]?.message;
  const toolCalls: ToolCall[] =
    msg?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      args: safeParseArgs(tc.function.arguments),
    })) ?? [];
  return { content: msg?.content?.trim() ? msg.content.trim() : null, toolCalls };
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}
