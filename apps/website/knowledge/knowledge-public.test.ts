import { describe, expect, it } from "vitest";
import { loadKnowledgeBase, loadKnowledgeChunks } from "@/lib/knowledge/loader";
import { retrieve } from "@/lib/knowledge/retriever";

describe("website knowledge base", () => {
  it("exposes the public topics without any booth/event-only material", async () => {
    const docs = await loadKnowledgeBase();
    const ids = docs.map((doc) => doc.id);

    expect(ids).toEqual([
      "project-intro",
      "data-equality",
      "ai-to-the-people",
      "who-we-serve",
      "cattle-license",
      "self-restraint",
      "direction-map",
      "hard-questions",
      "boundaries",
      "how-to-continue",
    ]);
    expect(ids).not.toContain("event-positioning");
  });

  it("keeps links from concise public topics back to source material", async () => {
    const docs = await loadKnowledgeBase();

    expect(docs.find((doc) => doc.id === "data-equality")?.sources).toContain(
      "source-data-equality-manifesto",
    );
    expect(docs.find((doc) => doc.id === "cattle-license")?.sources).toContain("source-cattle-license");
    expect(docs.find((doc) => doc.id === "direction-map")?.sources).toContain(
      "source-direction-map-handout",
    );
    expect(docs.find((doc) => doc.id === "direction-map")?.sources).toContain(
      "source-7x7-capability-theory",
    );
  });

  it("contains no booth or event language in user-facing material (title, tags, body)", async () => {
    const chunks = await loadKnowledgeChunks();
    const text = chunks.map((chunk) => `${chunk.title}\n${chunk.tags.join(" ")}\n${chunk.text}`).join("\n");

    const bannedTerms = [
      "摆摊",
      "摊位",
      "摊主",
      "小摊",
      "小金毛",
      "辩论",
      "小友赛",
      "扫码",
      "UP 主",
      "主办方",
      "现场",
      "围观",
    ];
    for (const banned of bannedTerms) {
      expect(text, `unexpected booth/event term: ${banned}`).not.toContain(banned);
    }
    expect(text).not.toContain("source-booth-conversation-notes");
  });

  it("keeps a complete 7x7 core framework source for theory questions", async () => {
    const chunks = await loadKnowledgeChunks();
    const text = chunks
      .filter((chunk) => chunk.sourceId === "source-7x7-capability-theory")
      .map((chunk) => `${chunk.title}\n${chunk.text}`)
      .join("\n");

    expect(text).toContain("横轴为什么是这七类人");
    expect(text).toContain("纵轴为什么是这七种能力");
    expect(text).toContain("阿马蒂亚·森");
    expect(text).toContain("玛莎·努斯鲍姆");
    expect(text).toContain("不是产品列表");
  });

  it("retrieves relevant material for common questions", async () => {
    const chunks = await loadKnowledgeChunks();

    expect(retrieve("牛马互助协议是不是 1/3 价", chunks, { limit: 1 })[0]?.chunk.sourceId).toBe(
      "cattle-license",
    );
    expect(retrieve("7x7 矩阵到底是产品吗", chunks, { limit: 1 })[0]?.chunk.sourceId).toBe(
      "source-7x7-capability-theory",
    );
    expect(retrieve("给我完整版数据平权宣言", chunks, { limit: 1 })[0]?.chunk.sourceId).toBe(
      "source-data-equality-manifesto",
    );
  });
});
