import { describe, expect, it } from "vitest";
import { AGE_HELP, DATA_HELP, PRODUCT_KNOWLEDGE } from "./product-knowledge";

describe("产品使用知识", () => {
  it("删除事实由模型按当前请求使用，不做关键词路由", () => {
    expect(DATA_HELP).toContain("没有替你执行删除");
    expect(PRODUCT_KNOWLEDGE).toContain("回答当前最新请求");
  });

  it("不把聊天资料留空说成可以免除成年核验", () => {
    expect(AGE_HELP).toContain("不能用微信登录或留空聊天资料代替");
  });

  it("产品事实只在被实际问到时相关", () => {
    expect(PRODUCT_KNOWLEDGE).toContain("必须区分用户本人的当前请求、引用、否定、历史经历和第三人称叙述");
    expect(PRODUCT_KNOWLEDGE).toContain("不要把无关设置说明整段塞进情绪倾诉");
    expect(PRODUCT_KNOWLEDGE).toContain("没有修改任何设置");
  });
});
