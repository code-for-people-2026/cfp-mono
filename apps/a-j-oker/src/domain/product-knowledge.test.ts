import { describe, expect, it } from "vitest";
import { AGE_HELP, DATA_HELP, DATA_TARGET_CLARIFICATION, REMINDER_HELP, PRODUCT_DELETE_CLARIFICATION, needsProductDeleteClarification, productHelp } from "./product-knowledge";

describe("产品使用知识", () => {
  it("只为已明确的本产品数据给出删除入口，其他对象先问清楚", () => {
    expect(productHelp("我想删除这个小程序里的个人资料，怎么操作？")).toBe(DATA_HELP);
    expect(productHelp("我想删除个人资料，怎么操作？")).toBe(DATA_TARGET_CLARIFICATION);
    expect(productHelp("你已经替我删掉所有聊天了吗？")).toBe(DATA_HELP);
    expect(DATA_HELP).toContain("没有替你执行删除");
    expect(productHelp("今天我整理了电脑桌面，有点累")).toBeUndefined();
  });
  it("不把聊天资料留空说成可以免除成年核验", () => {
    expect(productHelp("不想在聊天中填写身份证，还能聊天吗？")).toBe(AGE_HELP);
    expect(AGE_HELP).toContain("不能用微信登录或留空聊天资料代替");
  });
  it("关闭可选提醒的意愿不等于后台设置已经改变", () => {
    expect(productHelp("我不想设置提醒，先普通聊天")).toBe(REMINDER_HELP);
    expect(REMINDER_HELP).toContain("没有修改任何设置");
  });
});

it("本小程序删除入口整理需求先澄清，不当作无关制作拒绝", () => {
  const text = "请把“说明当前小程序的真实删除入口”的回答整理成可读卡片。";
  expect(productHelp(text)).toBe(PRODUCT_DELETE_CLARIFICATION);
  expect(productHelp("这个小程序怎么删掉？")).toBe(PRODUCT_DELETE_CLARIFICATION);
  expect(productHelp("我想删除这个小程序里的个人资料，怎么操作？")).toBe(DATA_HELP);
  expect(needsProductDeleteClarification("删除你们小程序服务器上的数据库")).toBe(false);
  expect(needsProductDeleteClarification("删除当前小程序他人的资料")).toBe(false);
  expect(needsProductDeleteClarification("把删除自己资料做成公益说明卡")).toBe(false);
});
