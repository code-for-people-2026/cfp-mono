import { callDeepSeek, type DeepSeekMessage } from "@/lib/deepseek/client";
import { loadKnowledgeChunks, type KnowledgeChunk } from "@/lib/knowledge/loader";
import { retrieve, type RetrievedChunk } from "@/lib/knowledge/retriever";
import { chatRateLimiter } from "@/lib/rateLimit";
import { chatRequestSchema } from "@/lib/validation";
import { buildChatPrompt } from "./buildChatPrompt";

const defaultRetrievalLimit = 6;
const expandedSourceRetrievalLimit = 48;
const defaultMaxTokens = 700;
const expandedSourceMaxTokens = 2400;

type HandleChatInput = {
  body: unknown;
  ip: string;
  now?: number;
  callModel?: typeof callDeepSeek;
  loadChunks?: typeof loadKnowledgeChunks;
};

function wantsExpandedSourceAnswer(message: string) {
  return /全文|完整版|原文|完整|全部/.test(message);
}

const explicitSourceMatchers: Array<{ sourceId: string; pattern: RegExp }> = [
  { sourceId: "source-data-equality-manifesto", pattern: /数据平权宣言|宣言/ },
  { sourceId: "source-cattle-license", pattern: /牛马互助协议|互助协议|工友价|传染条款|协议|cattle\s*license/i },
  { sourceId: "source-direction-map-handout", pattern: /7x7|7×7|七乘七|方向地图|能力剥夺|矩阵|表格/i },
  { sourceId: "source-production-vs-consumption", pattern: /生产.*消费|消费.*生产|空着的一格|小本经营/ },
];

function findExplicitSourceIds(query: string) {
  const sourceIds: string[] = [];

  for (const matcher of explicitSourceMatchers) {
    if (matcher.pattern.test(query)) sourceIds.push(matcher.sourceId);
  }

  return sourceIds;
}

function selectExplicitSourceChunks(sourceIds: string[], chunks: KnowledgeChunk[], limit: number) {
  const groupedChunks = sourceIds.map((sourceId) => chunks.filter((chunk) => chunk.sourceId === sourceId));
  const allExplicitChunks = groupedChunks.flat();

  if (allExplicitChunks.length <= limit) return allExplicitChunks;

  const perSourceLimit = Math.max(1, Math.floor(limit / sourceIds.length));
  const selectedChunks = groupedChunks.flatMap((group) => group.slice(0, perSourceLimit));
  const selectedIds = new Set(selectedChunks.map((chunk) => chunk.id));
  const remainingChunks = allExplicitChunks.filter((chunk) => !selectedIds.has(chunk.id));

  return [...selectedChunks, ...remainingChunks].slice(0, limit);
}

function retrieveForChat(query: string, chunks: KnowledgeChunk[], shouldExpandSourceAnswer: boolean) {
  const limit = shouldExpandSourceAnswer ? expandedSourceRetrievalLimit : defaultRetrievalLimit;
  const rankedChunks = retrieve(query, chunks, { limit, minimumScore: 1 });

  if (!shouldExpandSourceAnswer) return rankedChunks;

  const explicitSourceIds = findExplicitSourceIds(query);
  if (explicitSourceIds.length === 0) return rankedChunks;

  const explicitChunks = selectExplicitSourceChunks(explicitSourceIds, chunks, limit);
  const seenIds = new Set(explicitChunks.map((chunk) => chunk.id));
  const explicitResults: RetrievedChunk[] = explicitChunks.map((chunk, index) => ({
    chunk,
    score: 10_000 - index,
  }));

  return [
    ...explicitResults,
    ...rankedChunks.filter((item) => !seenIds.has(item.chunk.id)),
  ].slice(0, limit);
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
    const shouldExpandSourceAnswer = wantsExpandedSourceAnswer(parsed.data.message);
    const retrievalQuery = `${parsed.data.message}\n${parsed.data.conversationSummary}\n${parsed.data.messages
      .map((message) => message.content)
      .join("\n")}`;
    const retrievedChunks = retrieveForChat(retrievalQuery, chunks, shouldExpandSourceAnswer);

    const system = buildChatPrompt({
      mode: parsed.data.mode,
      conversationSummary: parsed.data.conversationSummary,
      retrievedChunks,
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
      maxTokens: shouldExpandSourceAnswer ? expandedSourceMaxTokens : defaultMaxTokens,
      signal: controller.signal,
    });

    return Response.json({ answer });
  } catch {
    return Response.json(
      { error: "网络可能有点不稳，可以重试一次。" },
      { status: 502 },
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
