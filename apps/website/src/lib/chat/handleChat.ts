import { callDeepSeek, type DeepSeekMessage } from "@/lib/deepseek/client";
import { loadKnowledgeChunks } from "@/lib/knowledge/loader";
import { retrieve } from "@/lib/knowledge/retriever";
import { chatRateLimiter } from "@/lib/rateLimit";
import { chatRequestSchema } from "@/lib/validation";
import { buildChatPrompt } from "./buildChatPrompt";

const retrievalLimit = 6;
const maxTokens = 700;

type HandleChatInput = {
  body: unknown;
  ip: string;
  now?: number;
  callModel?: typeof callDeepSeek;
  loadChunks?: typeof loadKnowledgeChunks;
};

// The user explicitly wants to read an original / full text.
function wantsOriginalText(message: string) {
  return /全文|完整版|原文|完整|全部/.test(message);
}

// Which canonical document the user is asking about — used to point them at the right
// link instead of reproducing the full text in chat.
const explicitSourceMatchers: Array<{ sourceId: string; pattern: RegExp }> = [
  { sourceId: "source-data-equality-manifesto", pattern: /数据平权宣言|宣言/ },
  { sourceId: "source-cattle-license", pattern: /牛马互助协议|互助协议|工友价|传染条款|协议|cattle\s*license/i },
  { sourceId: "source-direction-map-handout", pattern: /7x7|7×7|七乘七|方向地图|能力剥夺|矩阵|表格/i },
];

function findExplicitSourceIds(message: string) {
  return explicitSourceMatchers
    .filter((matcher) => matcher.pattern.test(message))
    .map((matcher) => matcher.sourceId);
}

export async function handleChat(input: HandleChatInput) {
  const limit = chatRateLimiter.check(input.ip, input.now);
  if (!limit.allowed) {
    return Response.json({ error: "请求有点太频繁了，可以稍等一下再试。" }, { status: 429 });
  }

  const parsed = chatRequestSchema.safeParse(input.body);
  if (!parsed.success) {
    return Response.json({ error: "问题太长或格式不对，可以缩短一点再问。" }, { status: 400 });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunks = await (input.loadChunks ?? loadKnowledgeChunks)();
    const retrievalQuery = `${parsed.data.message}\n${parsed.data.conversationSummary}\n${parsed.data.messages
      .map((message) => message.content)
      .join("\n")}`;
    const retrievedChunks = retrieve(retrievalQuery, chunks, { limit: retrievalLimit, minimumScore: 1 });

    // When the user wants an original/full text of a canonical doc, hint the model to
    // link out rather than paste the whole thing.
    const linkOutSourceIds = wantsOriginalText(parsed.data.message)
      ? findExplicitSourceIds(parsed.data.message)
      : [];

    const system = buildChatPrompt({
      mode: parsed.data.mode,
      conversationSummary: parsed.data.conversationSummary,
      retrievedChunks,
      linkOutSourceIds,
    });

    const messages: DeepSeekMessage[] = [
      { role: "system", content: system },
      ...parsed.data.messages.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content: parsed.data.message },
    ];

    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 20_000);
    const answer = await (input.callModel ?? callDeepSeek)({
      messages,
      maxTokens,
      signal: controller.signal,
    });

    return Response.json({ answer });
  } catch {
    return Response.json({ error: "网络可能有点不稳，可以重试一次。" }, { status: 502 });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
