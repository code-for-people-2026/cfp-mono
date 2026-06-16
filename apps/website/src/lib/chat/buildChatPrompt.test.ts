import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "./buildChatPrompt";

describe("buildChatPrompt (website)", () => {
  it("always offers the canonical reading links and a no-full-text rule", () => {
    const prompt = buildChatPrompt({ mode: "free", retrievedChunks: [] });

    expect(prompt).toContain("不要在对话里整段复制原文");
    expect(prompt).toContain("/manifesto");
    expect(prompt).toContain("/license");
    expect(prompt).toContain("https://wam.codeforpeople.cn/");
  });

  it("emphasizes linking out when the user is asking for an original text", () => {
    const prompt = buildChatPrompt({
      mode: "free",
      retrievedChunks: [],
      linkOutSourceIds: ["source-data-equality-manifesto"],
    });

    expect(prompt).toContain("用户当前正在要原文");
    expect(prompt).toContain("/manifesto");
  });

  it("does not add the emphasis line for ordinary questions", () => {
    const prompt = buildChatPrompt({ mode: "free", retrievedChunks: [] });
    expect(prompt).not.toContain("用户当前正在要原文");
  });
});
