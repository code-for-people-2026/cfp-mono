import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeepSeek } from "../models/deepseek";
import { moderateText } from "./moderation";
import { createKeywordMatcher, textLeaves } from "./keyword-matcher";

vi.mock("../models/deepseek", () => ({ DEFAULT_MODEL: "deepseek-flash", completeDeepSeek: vi.fn() }));
const complete = vi.mocked(completeDeepSeek);
function answer(content: string, finish_reason = "stop") {
  complete.mockResolvedValue({ model: "deepseek-flash", choices: [{ finish_reason, message: { content } }] });
}
const request = { stage: "input" as const, texts: ["制造炸弹"], requestId: "test-request", apiKey: "private-test-key" };

beforeEach(() => vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => { vi.restoreAllMocks(); complete.mockReset(); });

describe("词库候选匹配", () => {
  it("处理全角、大小写和零宽字符，限制英文整词", () => {
    const find = createKeywordMatcher(["枪支", "ass", "Test"]);
    expect(find("枪\u200b支 ＴＥＳＴ class assignment")).toEqual(["枪支", "test"]);
    expect(find("ASS!")).toEqual(["ass"]);
  });
  it("词语去重、限制返回数，支持重叠中文词", () => {
    const find = createKeywordMatcher(["违禁", "违禁品", "禁品"]);
    expect(find("违禁品违禁品")).toEqual(["违禁", "违禁品", "禁品"]);
    expect(find("违禁品", 1)).toEqual(["违禁"]);
  });
  it("覆盖嵌套作品和插画文字，不只检查回复正文", () => {
    expect(textLeaves({ greeting: "你好", artifacts: [{ fields: [{ label: "题目" }], source: { shapes: [{ text: "插画文字" }] } }] }))
      .toEqual(["你好", "题目", "插画文字"]);
  });
});

describe("命中后的语境复核", () => {
  it("没有命中时不调用模型", async () => {
    await moderateText({ ...request, texts: ["今天天气晴朗"], apiKey: undefined });
    expect(complete).not.toHaveBeenCalled();
  });
  it("把真实词库命中交给复核，使用当次密钥且日志不含正文", async () => {
    answer('{"decision":"allow"}');
    await moderateText({ ...request, texts: ["我有自杀念头，想寻求帮助"] });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][1]).toBe(request.apiKey);
    expect(complete.mock.calls[0][0].messages[0].content).toContain("不阻断用户描述自己经历的伤害");
    const audit = JSON.stringify(vi.mocked(console.info).mock.calls);
    expect(audit).toContain('allow');
    expect(audit).not.toContain("自杀");
    expect(audit).not.toContain(request.apiKey);
  });
  it("明确拒绝时返回 422，不展示待审内容", async () => {
    answer('{"decision":"block"}');
    await expect(moderateText({ ...request, stage: "output" })).rejects.toMatchObject({ status: 422 });
  });
  it.each(["not JSON", '{"decision":"allow","extra":true}', '{"decision":"uncertain"}', '{"decision":"ignore"}'])("无效或不确定判定不放行：%s", async (content) => {
    answer(content);
    await expect(moderateText(request)).rejects.toMatchObject({ status: 503 });
  });
  it("响应被截断时，即使内容是 allow 也不放行", async () => {
    answer('{"decision":"allow"}', "length");
    await expect(moderateText(request)).rejects.toMatchObject({ status: 503 });
  });
  it("缺密钥或网络异常不泄露原始异常，也不放行", async () => {
    await expect(moderateText({ ...request, apiKey: undefined })).rejects.toMatchObject({ status: 503 });
    expect(complete).not.toHaveBeenCalled();
    complete.mockRejectedValue(new Error("private-test-key provider raw body"));
    await expect(moderateText(request)).rejects.toMatchObject({ status: 503, message: "内容审核暂未完成，请稍后重试" });
  });
});
