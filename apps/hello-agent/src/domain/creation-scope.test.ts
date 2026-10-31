import { describe, expect, it } from "vitest";
import { isRestReminderRequest, isUnsupportedCreation } from "./creation-scope";
describe("首版创作范围", () => {
  it.each(["请生成中文计算卡：13朵花，加5朵，送出3朵，写出剩余数量及算式。", "制作计算卡，只要文字", "制作公益海报", "做一张反歧视海报", "画一张图片", "请制作一张休息提醒卡，另附计算题", "generate a poster"])("拒绝通用或混合制作：%s", text => { expect(isUnsupportedCreation(text)).toBe(true); expect(isRestReminderRequest(text)).toBe(false); });
  it.each(["请制作休息提醒卡", "给我一张提醒休息卡", "生成一张放松提醒卡", "make a rest reminder card"])("仅允许审核休息提醒卡：%s", text => { expect(isRestReminderRequest(text)).toBe(true); expect(isUnsupportedCreation(text)).toBe(false); });
  it.each(["我因为做计算题感到焦虑", "我在制作海报时感到焦虑", "什么是计算卡？", "我很累，想休息", "再做一张"])("不误拒绝倾诉，未知意图也不自动生图：%s", text => { expect(isUnsupportedCreation(text)).toBe(false); expect(isRestReminderRequest(text)).toBe(false); });
});
