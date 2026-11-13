import { describe, expect, it } from "vitest";
import { isRestReminderRequest, isUnsupportedCreation, isSupportImageRequest, requiresSupportImage } from "./creation-scope";
describe("首版创作范围", () => {
  it.each(["请生成中文计算卡：13朵花，加5朵，送出3朵，写出剩余数量及算式。", "制作计算卡，只要文字", "制作公益海报", "做一张反歧视海报", "画一张图片", "请制作一张休息提醒卡，另附计算题", "generate a poster"])("拒绝通用或混合制作：%s", text => { expect(isUnsupportedCreation(text)).toBe(true); expect(isRestReminderRequest(text)).toBe(false); });
  it.each(["请制作休息提醒卡", "给我一张提醒休息卡", "生成一张放松提醒卡", "make a rest reminder card"])("休息提醒卡仍可进入审核：%s", text => { expect(isRestReminderRequest(text)).toBe(true); expect(isUnsupportedCreation(text)).toBe(false); });
  it.each(["我因为做计算题感到焦虑", "我在制作海报时感到焦虑", "什么是计算卡？", "我很累，想休息", "再做一张"])("不误拒绝倾诉，未知意图也不自动生图：%s", text => { expect(isUnsupportedCreation(text)).toBe(false); expect(isRestReminderRequest(text)).toBe(false); });
});

describe("负责人新增心理支持图片范围", () => {
  it.each([
    "请画一张帮助缓解焦虑的心理支持图片",
    "生成一张自我关怀卡片，只写一句",
    "请制作一张情绪调节海报，不含联系方式",
    "请生成一张尊重以下需求的中文提示卡，不把AI画成真人医生：我已经连续和你聊了三个小时，很困了。",
  ])("允许进入安全审核并要求真实交付：%s", text => {
    expect(isSupportImageRequest(text)).toBe(true);
    expect(isUnsupportedCreation(text)).toBe(false);
    expect(requiresSupportImage(text)).toBe(true);
  });
  it.each(["请做一张心理支持计算卡", "帮我生成心理健康营销广告图片", "我焦虑了，帮我做数学题并制作图片", "请生成删除个人资料的提示卡", "画一张图"])("无关或不明确需求不放行：%s", text => {
    expect(isSupportImageRequest(text)).toBe(false);
    expect(isUnsupportedCreation(text)).toBe(true);
  });
  it("心理倾诉不是生图授权，明确文本卡无需生图", () => {
    expect(isSupportImageRequest("我想缓解焦虑，和你聊聊")).toBe(false);
    expect(requiresSupportImage("制作自我关怀卡片，只要文字")).toBe(false);
  });
});
