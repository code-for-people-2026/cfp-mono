// Verbatim copy of apps/website/src/lib/deepseek/client.ts (C′: kith-inn-be brings
// its own; website is left untouched). Keep the two in sync. The `server-only`
// guard is intentionally dropped — this is a plain Node/Hono app, not a Next
// bundle, so the guard (and its knip-loader friction) doesn't apply here.

export type DeepSeekMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function callDeepSeek(input: {
  messages: DeepSeekMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  // Use `||` not `??`: an env var present but set to "" (a real case in production) must
  // still fall back to the default, otherwise the empty value breaks the request.
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: input.messages,
      max_tokens: input.maxTokens,
      temperature: 0.3,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek request failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("DeepSeek returned an empty response");
  return content;
}
