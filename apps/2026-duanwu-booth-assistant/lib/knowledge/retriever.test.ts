import { describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "./loader";
import { retrieve } from "./retriever";

const chunks: KnowledgeChunk[] = [
  {
    id: "intro#0",
    sourceId: "intro",
    title: "项目介绍",
    kind: "topic",
    sources: [],
    tags: ["数据平权"],
    text: "数据平权讨论普通用户产生的数据价值不应只被平台占有。",
    filePath: "/knowledge/intro.md",
  },
  {
    id: "ai#0",
    sourceId: "ai",
    title: "为什么是 AI",
    kind: "topic",
    sources: [],
    tags: ["AI"],
    text: "AI 可能被用来提高监控和管理强度，关键是 AI 被谁掌握、为谁服务。",
    filePath: "/knowledge/ai.md",
  },
  {
    id: "contact#0",
    sourceId: "contact",
    title: "如何继续了解",
    kind: "topic",
    sources: [],
    tags: ["继续了解"],
    text: "如果想继续聊，可以等摊主空下来直接聊，也可以打开继续了解区域。",
    filePath: "/knowledge/contact.md",
  },
];

describe("retrieve", () => {
  it("returns chunks ranked by Chinese keyword overlap", () => {
    const results = retrieve("AI 会不会变成资本提高剥削效率的工具", chunks, { limit: 2 });

    expect(results.map((item) => item.chunk.id)).toEqual(["ai#0", "intro#0"]);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("returns contact material when user asks how to continue", () => {
    const results = retrieve("怎么联系你们，后续怎么继续聊", chunks, { limit: 1 });

    expect(results[0]?.chunk.id).toBe("contact#0");
  });

  it("returns an empty list when there is no useful overlap", () => {
    const results = retrieve("今天晚饭吃什么", chunks, { limit: 3, minimumScore: 2 });

    expect(results).toEqual([]);
  });
});
