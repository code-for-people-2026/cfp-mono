import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "./buildChatPrompt";

describe("buildChatPrompt (website)", () => {
  it("always offers the canonical reading links and a no-full-text rule", () => {
    const prompt = buildChatPrompt({ mode: "free", retrievedChunks: [] });

    expect(prompt).toContain("不要在对话里整段复制原文");
    expect(prompt).toContain("/manifesto");
    expect(prompt).toContain("/license");
    expect(prompt).toContain("/wam");
    expect(prompt).toContain("/neighbors");
  });

  it("hands the model clickable markdown links, not bare paths", () => {
    const prompt = buildChatPrompt({ mode: "free", retrievedChunks: [] });

    expect(prompt).toContain("[《数据平权宣言》全文](/manifesto)");
    expect(prompt).toContain("[《牛马互助协议》全文](/license)");
    expect(prompt).toContain("[牛马能力剥夺矩阵](/wam)");
    expect(prompt).toContain("[近邻互助组介绍](/neighbors)");
    expect(prompt).toContain("markdown 链接格式");
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

  it("routes neighbors questions to product material without inventing the prototype URL", () => {
    const prompt = buildChatPrompt({ mode: "free", retrievedChunks: [] });

    expect(prompt).toContain("近邻互助组、本人亲历、亲历卡、服务者、Agent 分责");
    expect(prompt).toContain("不要编造原型网址");
  });
});
