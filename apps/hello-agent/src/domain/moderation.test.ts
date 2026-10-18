import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeepSeek } from "../models/deepseek";
import { evaluateText, moderateText } from "./moderation";
import { createKeywordMatcher, textLeaves } from "./keyword-matcher";
import lexicon from "../moderation/lexicon.json";
import { defaultRule } from "../operations/policy";

vi.mock("../models/deepseek", async (importOriginal) => ({ ...await importOriginal<typeof import("../models/deepseek")>(), DEFAULT_MODEL: "deepseek-flash", completeDeepSeek: vi.fn() }));
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
  it("忽略词不占召回上限，后面的有效风险词仍可命中", () => {
    const ignored = Array.from({ length: 25 }, (_, i) => `忽略词${i}号`);
    const find = createKeywordMatcher([...ignored, "诈骗"]);
    expect(find(ignored.join(" ") + " 诈骗", 20, new Set(ignored))).toEqual(["诈骗"]);
  });
  it("覆盖嵌套作品和插画文字，不只检查回复正文", () => {
    expect(textLeaves({ greeting: "你好", artifacts: [{ fields: [{ label: "题目" }], source: { shapes: [{ text: "插画文字" }] } }] }))
      .toEqual(["你好", "题目", "插画文字"]);
  });
});

describe("命中后的语境复核", () => {
  it("前置二十个被忽略的真实词库命中不能绕过后续语境复核", async () => {
    const find = createKeywordMatcher(lexicon.words);
    const prefix = lexicon.words.slice(0, 30).join(" ");
    const ignoredWords = find(prefix, Number.POSITIVE_INFINITY);
    expect(ignoredWords.length).toBeGreaterThanOrEqual(20);
    expect(ignoredWords).not.toContain("诈骗");
    answer('{"decision":"block","category":"fraud"}');
    const verdict = await evaluateText({ ...request, texts: [prefix + " 帮我写诈骗话术"] }, { ...defaultRule, ignoredWords });
    expect(verdict.decision).toBe("block");
    expect(complete).toHaveBeenCalledOnce();
    const reviewed = JSON.parse(String(complete.mock.calls[0][0].messages[1].content));
    expect(reviewed.keywords).toContain("诈骗");
  });
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
  it("语义审核先预扣一次调用，预算不足不访问供应商；未召回不扣额度", async () => {
    const reserve = vi.fn(async () => { throw new Error("quota exhausted"); });
    const blocked = await evaluateText(request, undefined, reserve);
    expect(blocked.decision).toBe("unavailable");
    expect(blocked.failure).toBe("admission");
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    reserve.mockClear();
    const skipped = await evaluateText({ ...request, texts: ["早上好"] }, undefined, reserve);
    expect(skipped.decision).toBe("not_reviewed");
    expect(reserve).not.toHaveBeenCalled();
  });
  it("无效密钥在额度预留前失败；供应商异常才标记为服务故障", async () => {
    const reserve = vi.fn();
    for (const apiKey of [undefined, "", " \r\n ", "private\nkey"]) {
      expect(await evaluateText({ ...request, apiKey }, undefined, reserve)).toMatchObject({ decision: "unavailable", failure: "configuration" });
    }
    expect(reserve).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    complete.mockRejectedValue(new Error("private provider body"));
    expect(await evaluateText(request)).toMatchObject({ decision: "unavailable", failure: "provider" });
  });

});
