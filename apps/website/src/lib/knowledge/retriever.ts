import type { KnowledgeChunk } from "./loader";

export type RetrievedChunk = {
  chunk: KnowledgeChunk;
  score: number;
};

export type RetrieveOptions = {
  limit?: number;
  minimumScore?: number;
};

const stopwords = new Set([
  "这个",
  "那个",
  "什么",
  "怎么",
  "为什么",
  "你们",
  "我们",
  "他们",
  "是不是",
  "有没有",
  "一下",
  "可以",
  "的",
  "了",
  "和",
  "是",
  "在",
]);

const queryExpansions: Array<[RegExp, string[]]> = [
  [/资本|剥削|工具|平台/, ["数据", "平台", "价值", "平权"]],
  [/联系|加入|网站|后续|继续/, ["继续了解", "摊主", "联系方式"]],
  [/工友|劳动者|服务谁|代表/, ["工友", "普通劳动者", "服务对象"]],
  [/用户调研|渠道侦察|现场人群|辩论赛现场|收集痛点/, ["用户调研", "渠道侦察", "辩论赛", "现场人群"]],
  [/全文|完整版|原文|完整|全部/, ["全文", "原文", "完整", "source"]],
];

type QueryToken = {
  token: string;
  weight: number;
};

function tokenize(input: string): QueryToken[] {
  const normalized = input.toLowerCase().replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, " ");
  const asciiTokens = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const chineseTokens = normalized.match(/\p{Script=Han}{2,}/gu) ?? [];
  const expandedTokens = queryExpansions.flatMap(([pattern, tokens]) => (pattern.test(input) ? tokens : []));
  const bigrams = chineseTokens.flatMap((token) => {
    const result: string[] = [];
    for (let index = 0; index < token.length - 1; index += 1) {
      result.push(token.slice(index, index + 2));
    }
    return result;
  });

  return [
    ...asciiTokens.map((token) => ({ token, weight: 3 })),
    ...chineseTokens.map((token) => ({ token, weight: 3 })),
    ...bigrams.map((token) => ({ token, weight: 2 })),
    ...expandedTokens.map((token) => ({ token, weight: 1 })),
  ].filter((item) => !stopwords.has(item.token));
}

function scoreChunk(queryTokens: QueryToken[], chunk: KnowledgeChunk) {
  const title = chunk.title.toLowerCase();
  const tags = chunk.tags.map((tag) => tag.toLowerCase());
  const haystack = `${title}\n${tags.join(" ")}\n${chunk.text}`.toLowerCase();

  return queryTokens.reduce((score, { token, weight }) => {
    if (!haystack.includes(token)) return score;
    const tagBoost = tags.some((tag) => tag.includes(token)) ? 2 : 0;
    const titleBoost = title.includes(token) ? 2 : 0;
    return score + weight + tagBoost + titleBoost;
  }, 0);
}

function compareChunkId(left: string, right: string) {
  const [leftSource, leftIndex] = left.split("#");
  const [rightSource, rightIndex] = right.split("#");

  if (leftSource !== rightSource) return left.localeCompare(right);

  const leftNumber = Number(leftIndex);
  const rightNumber = Number(rightIndex);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right);
}

export function retrieve(query: string, chunks: KnowledgeChunk[], options: RetrieveOptions = {}) {
  const limit = options.limit ?? 6;
  const minimumScore = options.minimumScore ?? 1;
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0) return [];

  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(queryTokens, chunk) }))
    .filter((item) => item.score >= minimumScore)
    .sort((a, b) => b.score - a.score || compareChunkId(a.chunk.id, b.chunk.id))
    .slice(0, limit);
}
