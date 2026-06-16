import { describe, expect, it, vi } from "vitest";
import { handleChat } from "./handleChat";

describe("handleChat", () => {
  it("returns an assistant answer from retrieved material", async () => {
    const callModel = vi.fn().mockResolvedValue("数据平权讨论普通用户产生的数据价值如何被看见和分配。");
    const response = await handleChat({
      body: {
        mode: "free",
        message: "数据平权是什么意思",
        messages: [],
        conversationSummary: "",
      },
      ip: "1.2.3.4",
      now: 0,
      callModel,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "数据平权讨论普通用户产生的数据价值如何被看见和分配。",
    });
    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 700,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("数据平权是什么意思"),
          }),
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("红利归于人民"),
          }),
          expect.objectContaining({
            role: "user",
            content: "数据平权是什么意思",
          }),
        ]),
      }),
    );
  });

  it("allows longer source-grounded answers when the user asks for a full original document", async () => {
    const callModel = vi.fn().mockResolvedValue("《数据平权宣言》全文。");
    await handleChat({
      body: {
        mode: "free",
        message: "给我完整版数据平权宣言",
        messages: [],
        conversationSummary: "",
      },
      ip: "1.2.3.9",
      now: 0,
      callModel,
      loadChunks: vi.fn().mockResolvedValue(
        Array.from({ length: 12 }, (_, index) => ({
          id: `source-data-equality-manifesto#${index}`,
          sourceId: "source-data-equality-manifesto",
          title: "数据平权宣言全文",
          kind: "source",
          sources: ["ideal/第一个产品/宣言-数据平权.md"],
          sourcePath: "ideal/第一个产品/宣言-数据平权.md",
          tags: ["数据平权", "宣言", "全文", "原文"],
          text: `宣言第 ${index + 1} 段。`,
          filePath: "/knowledge/sources/source-data-equality-manifesto.md",
        })),
      ),
    });

    expect(callModel).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 2400,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("宣言第 12 段。"),
          }),
        ]),
      }),
    );
  });

  it("keeps all explicitly requested source documents in the prompt for combined full-text requests", async () => {
    const callModel = vi.fn().mockResolvedValue("可以，我先分别说明这两份材料。");
    await handleChat({
      body: {
        mode: "free",
        message: "我想看完整版的宣言和牛马互助协议",
        messages: [],
        conversationSummary: "",
      },
      ip: "1.2.3.19",
      now: 0,
      callModel,
    });

    const systemPrompt = callModel.mock.calls[0]?.[0].messages.find(
      (message: { role: string; content: string }) => message.role === "system",
    )?.content;

    expect(systemPrompt).toContain("来源ID：source-data-equality-manifesto");
    expect(systemPrompt).toContain("来源ID：source-cattle-license");
    expect(systemPrompt).toContain("数据平权宣言全文");
    expect(systemPrompt).toContain("牛马互助协议全文");
    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 2400 }));
  });

  it("rejects overlong user input", async () => {
    const response = await handleChat({
      body: {
        mode: "free",
        message: "x".repeat(1001),
        messages: [],
        conversationSummary: "",
      },
      ip: "1.2.3.4",
      now: 0,
      callModel: vi.fn(),
    });

    expect(response.status).toBe(400);
  });

  it("returns a friendly fallback when knowledge loading fails", async () => {
    const response = await handleChat({
      body: {
        mode: "free",
        message: "数据平权是什么意思",
        messages: [],
        conversationSummary: "",
      },
      ip: "9.9.9.9",
      now: 0,
      callModel: vi.fn(),
      loadChunks: vi.fn().mockRejectedValue(new Error("missing knowledge")),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "网络可能有点不稳，可以重试一次。也可以直接回摊位找摊主问这个问题。",
    });
  });

  it("returns a friendly fallback when the model fails", async () => {
    const response = await handleChat({
      body: {
        mode: "free",
        message: "数据平权是什么意思",
        messages: [],
        conversationSummary: "",
      },
      ip: "8.8.8.8",
      now: 0,
      callModel: vi.fn().mockRejectedValue(new Error("model down")),
    });

    expect(response.status).toBe(502);
  });
});
