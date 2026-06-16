import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadKnowledgeBase, loadKnowledgeChunks, splitIntoChunks } from "./loader";

const fixtureDir = path.join(process.cwd(), "test/fixtures/knowledge");
const fixtureSourceDir = path.join(process.cwd(), "test/fixtures/knowledge-sources");

describe("loadKnowledgeBase", () => {
  it("loads only public approved markdown files", async () => {
    const docs = await loadKnowledgeBase(fixtureDir);

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      id: "approved",
      title: "Approved Material",
      visibility: "public",
      status: "approved",
      tags: ["数据平权", "AI 下乡"],
    });
    expect(docs[0]?.content).toContain("数据平权强调");
  });
});

describe("splitIntoChunks", () => {
  it("preserves source metadata and repeats heading context for each paragraph chunk", () => {
    const chunks = splitIntoChunks({
      id: "approved",
      title: "Approved Material",
      visibility: "public",
      status: "approved",
      kind: "topic",
      sources: [],
      tags: ["数据平权"],
      content: "## 核心说明\n\n第一段内容。\n\n第二段内容。",
      filePath: "/tmp/approved.md",
    });

    expect(chunks).toEqual([
      expect.objectContaining({
        id: "approved#0",
        sourceId: "approved",
        title: "Approved Material",
        tags: ["数据平权"],
        text: "核心说明\n\n第一段内容。",
        filePath: "/tmp/approved.md",
      }),
      expect.objectContaining({
        id: "approved#1",
        sourceId: "approved",
        title: "Approved Material",
        tags: ["数据平权"],
        text: "核心说明\n\n第二段内容。",
        filePath: "/tmp/approved.md",
      }),
    ]);
  });
});

describe("loadKnowledgeChunks", () => {
  it("loads approved material and returns chunked content", async () => {
    const chunks = await loadKnowledgeChunks(fixtureDir);

    expect(chunks).toEqual([
      expect.objectContaining({
        id: "approved#0",
        sourceId: "approved",
        title: "Approved Material",
        tags: ["数据平权", "AI 下乡"],
        text: expect.stringContaining("数据平权强调"),
        filePath: expect.stringContaining("approved.md"),
      }),
      expect.objectContaining({
        id: "approved#1",
        sourceId: "approved",
        title: "Approved Material",
        tags: ["数据平权", "AI 下乡"],
        text: expect.stringContaining("如果想继续聊"),
        filePath: expect.stringContaining("approved.md"),
      }),
    ]);
  });

  it("loads public topics and source documents together with traceable source metadata", async () => {
    const chunks = await loadKnowledgeChunks([fixtureDir, fixtureSourceDir]);

    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "source-manifesto#0",
          sourceId: "source-manifesto",
          title: "Source Manifesto",
          kind: "source",
          sourcePath: "ideal/第一个产品/宣言-数据平权.md",
          sources: ["ideal/第一个产品/宣言-数据平权.md"],
          text: expect.stringContaining("一个幽灵，数据平权的幽灵"),
        }),
      ]),
    );
  });
});
