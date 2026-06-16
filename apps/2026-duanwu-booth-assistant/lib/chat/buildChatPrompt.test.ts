import { describe, expect, it } from "vitest";
import { buildChatPrompt, buildSummaryPrompt } from "./buildChatPrompt";

describe("buildChatPrompt", () => {
  it("includes role, boundaries, retrieved material, and source-on-request rule", () => {
    const prompt = buildChatPrompt({
      mode: "doubt",
      conversationSummary: "用户关心 AI 是否会被资本用于剥削。",
      retrievedChunks: [
        {
          chunk: {
            id: "ai#0",
            sourceId: "why-ai",
            title: "为什么是 AI",
            kind: "topic",
            sources: [],
            tags: ["AI"],
            text: "AI 可能被用来提高监控和管理强度。",
            filePath: "/knowledge/why-ai.md",
          },
          score: 5,
        },
      ],
    });

    expect(prompt).toContain("你是“数据平权，AI 下乡”摊位的 AI 助手");
    expect(prompt).toContain("用户追问依据、来源、原文时，才说明材料来源");
    expect(prompt).toContain("当前入口模式：我有点怀疑");
    expect(prompt).toContain("为什么是 AI");
    expect(prompt).toContain("AI 可能被用来提高监控和管理强度");
  });

  it("guides each answer toward one relevant core document without forcing all three", () => {
    const prompt = buildChatPrompt({
      mode: "intro",
      retrievedChunks: [],
    });

    expect(prompt).toContain("先直接回答用户当前问题");
    expect(prompt).toContain("自然引向《数据平权宣言》《牛马互助协议》或 7x7 矩阵之一");
    expect(prompt).toContain("只选择最相关的一份核心内容");
    expect(prompt).toContain("不要在每次回答里同时硬塞三份");
    expect(prompt).toContain("理念、为什么做、数据归谁、AI 红利");
    expect(prompt).toContain("组织约束、工友价、1/3 价、怎么防止变质");
    expect(prompt).toContain("具体做什么、服务谁、哪些人和哪些能力");
  });

  it("includes traceable source metadata when retrieved material comes from a source document", () => {
    const prompt = buildChatPrompt({
      mode: "free",
      retrievedChunks: [
        {
          chunk: {
            id: "source-manifesto#0",
            sourceId: "source-manifesto",
            title: "数据平权宣言全文",
            kind: "source",
            sourcePath: "ideal/第一个产品/宣言-数据平权.md",
            sources: ["ideal/第一个产品/宣言-数据平权.md"],
            tags: ["数据平权", "原文"],
            text: "一个幽灵，数据平权的幽灵，正在互联网上游荡。",
            filePath: "/knowledge/sources/source-data-equality-manifesto.md",
          },
          score: 8,
        },
      ],
    });

    expect(prompt).toContain("材料类型：source");
    expect(prompt).toContain("原始来源：ideal/第一个产品/宣言-数据平权.md");
  });
});

describe("buildSummaryPrompt", () => {
  it("forbids adding new project claims", () => {
    const prompt = buildSummaryPrompt([
      { id: "1", role: "user", content: "你们凭什么代表工友？" },
      { id: "2", role: "assistant", content: "项目不能声称已经代表工友。" },
    ]);

    expect(prompt).toContain("不要添加新观点");
    expect(prompt).toContain("不能补充知识库没有的项目立场");
  });
});
