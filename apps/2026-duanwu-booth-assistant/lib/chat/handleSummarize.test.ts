import { describe, expect, it, vi } from "vitest";
import { handleSummarize } from "./handleSummarize";

describe("handleSummarize", () => {
  it("returns an updated conversation summary", async () => {
    const response = await handleSummarize({
      body: {
        previousSummary: "",
        messages: [
          { id: "1", role: "user", content: "AI 会不会变成剥削工具？" },
          { id: "2", role: "assistant", content: "这个风险真实存在。" },
        ],
      },
      ip: "1.2.3.4",
      now: 0,
      callModel: vi.fn().mockResolvedValue("用户关心 AI 是否会被用于剥削；助手承认风险真实存在。"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summary: "用户关心 AI 是否会被用于剥削；助手承认风险真实存在。",
    });
  });

  it("rejects invalid summary payloads", async () => {
    const response = await handleSummarize({
      body: {
        previousSummary: "",
        messages: [],
      },
      ip: "2.2.2.2",
      now: 0,
      callModel: vi.fn(),
    });

    expect(response.status).toBe(400);
  });
});
