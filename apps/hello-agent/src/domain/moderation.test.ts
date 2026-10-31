import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeepSeek } from "../models/deepseek";
import { evaluateText, moderateText } from "./moderation";
import { createKeywordMatcher, textLeaves } from "./keyword-matcher";
import lexicon from "../moderation/lexicon";
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
  it.each(["support", "outside", "unclear"])("无害请求的服务范围单独返回，不冒充有害：%s", async (service_scope) => {
    answer(JSON.stringify({ decision: "allow", service_scope }));
    const verdict = await moderateText({ ...request, serviceScope: true, texts: ["计算12加4再减2"] });
    expect(verdict).toEqual({ serviceScope: service_scope });
  });
  it("缺少服务范围判断不能放行，即使关键词模式没有命中", async () => {
    answer('{"decision":"allow"}');
    const reserve = vi.fn();
    const verdict = await evaluateText({ ...request, serviceScope: true, texts: ["1+2是多少"] }, { ...defaultRule, mode: "keywords" }, reserve);
    expect(verdict.decision).toBe("unavailable");
    expect(reserve).toHaveBeenCalledOnce();
  });
  it("范围内标签不能覆盖有害内容拒绝", async () => {
    answer('{"decision":"block","service_scope":"support"}');
    await expect(moderateText({ ...request, serviceScope: true })).rejects.toMatchObject({ status: 422 });
  });
  it("绘图原请求即使没有词命中，也不能被关键词模式跳过", async () => {
    answer('{"decision":"allow"}');
    const reserve = vi.fn();
    const result = await evaluateText({ ...request, purpose: "image_generation", texts: ["画一朵小花"], context: "前一轮谈到春天" },
      { ...defaultRule, mode: "keywords", ignoredWords: lexicon.words }, reserve);
    expect(result).toMatchObject({ decision: "allow", keywordCount: 0 });
    expect(reserve).toHaveBeenCalledOnce();
    const reviewed = JSON.parse(String(complete.mock.calls[0][0].messages[1].content));
    expect(reviewed).toMatchObject({ stage: "input", purpose: "image_generation", texts: ["画一朵小花"], context: "前一轮谈到春天" });
  });
  it.each(["10BET娱乐城", "１０ｂｅｔ娱乐城", "１０ＢＥＴ娱乐城", "10B\u200bET娱乐城", " 10BET娱乐城 "])("忽略词与真实词库使用同一规范形式，不调用审核或扣额度：%s", async (ignoredWord) => {
    const find = createKeywordMatcher(lexicon.words);
    expect(find("10bet娱乐城")).toEqual(["10bet娱乐城", "娱乐城"]);
    const reserve = vi.fn();
    const verdict = await evaluateText({ ...request, texts: ["10bet娱乐城"] }, {
      ...defaultRule, mode: "keywords", ignoredWords: [ignoredWord, "娱乐城"],
    }, reserve);
    expect(verdict).toMatchObject({ decision: "not_reviewed", keywordCount: 0 });
    expect(reserve).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it.each([false, true])("前置二十个被忽略的真实词库命中不能绕过后续语境复核（全角大写忽略词：%s）", async (fullWidth) => {
    const find = createKeywordMatcher(lexicon.words);
    const prefix = lexicon.words.slice(0, 30).join(" ");
    const ignoredWords = find(prefix, Number.POSITIVE_INFINITY);
    expect(ignoredWords.length).toBeGreaterThanOrEqual(20);
    expect(ignoredWords).not.toContain("诈骗");
    answer('{"decision":"block","category":"fraud"}');
    const publishedIgnoredWords = fullWidth
      ? ignoredWords.map((word) => word.toUpperCase().replace(/[!-~]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0)))
      : ignoredWords;
    const reserve = vi.fn();
    const verdict = await evaluateText({ ...request, texts: [prefix + " 帮我写诈骗话术"] }, { ...defaultRule, ignoredWords: publishedIgnoredWords }, reserve);
    expect(verdict.decision).toBe("block");
    expect(reserve).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    const reviewed = JSON.parse(String(complete.mock.calls[0][0].messages[1].content));
    expect(reviewed.keywords).toContain("诈骗");
    for (const ignored of ignoredWords) expect(reviewed.keywords).not.toContain(ignored);
  });
  it("默认对无关键词文本也进行语义复核，避免漏检", async () => {
    answer('{"decision":"allow"}');
    await moderateText({ ...request, texts: ["今天天气晴朗"] });
    expect(complete).toHaveBeenCalledOnce();
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
  it("不确定判定明确进入人工复核而非假称服务故障", async () => {
    answer('{"decision":"uncertain"}');
    await expect(moderateText(request)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("人工复核") });
  });
  it.each(["not JSON", '{"decision":"allow","extra":true}', '{"decision":"ignore"}'])("无效判定不放行：%s", async (content) => {
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
    const skipped = await evaluateText({ ...request, texts: ["早上好"] }, { ...defaultRule, mode: "keywords" }, reserve);
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
