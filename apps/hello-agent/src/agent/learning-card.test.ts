import { describe, expect, it } from "vitest";
import { needsLearningCardImage } from "./learning-card";
describe("learning card output intent", () => {
  it.each(["请生成中文计算卡：13朵花，加5朵，送出3朵，写出剩余数量及算式。", "帮我制作一套识字卡", "设计一张单词卡"])("requires a printable image: %s", text => expect(needsLearningCardImage(text)).toBe(true));
  it.each(["什么是计算卡？", "请生成中文计算卡，只要文字内容", "设计单词卡，不要图片", "给我一张信用卡消费表格", "做一张行动卡，写一句提醒"])("does not force image: %s", text => expect(needsLearningCardImage(text)).toBe(false));
});
