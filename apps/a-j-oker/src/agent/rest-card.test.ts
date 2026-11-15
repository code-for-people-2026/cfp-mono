import { expect, it } from "vitest";
import { imagePromptConstraints, restCardDeliveryError } from "./rest-card";
it("一句文案不等于只要文字，空作品和虚构/旧图片都不能算交付", () => {
 const reply = { greeting: "卡片已做好", association: "测试" };
 expect(restCardDeliveryError(true, reply, undefined, false)).toBeTruthy();
 expect(restCardDeliveryError(true, {...reply,artifacts:[{kind:"image",id:"rest",title:"休息",alt:"休息",source:{type:"media",mediaId:9}}]}, 8, false)).toBeTruthy();
 expect(restCardDeliveryError(true, {...reply,artifacts:[{kind:"image",id:"rest",title:"休息",alt:"休息",source:{type:"media",mediaId:8}}]}, 8, false)).toBeUndefined();
 expect(restCardDeliveryError(true, reply, undefined, true)).toBeUndefined();
 expect(restCardDeliveryError(false, reply, undefined, false)).toBeUndefined();
  expect(restCardDeliveryError(false, reply, undefined, false)).toBeUndefined();
});
it("提示约束保持静态并要求按当前语义执行用户约束", () => {
 const constraints = imagePromptConstraints();
 expect(constraints).toContain("当前请求和语境");
 expect(constraints).toContain("引用、示例、否定或历史素材");
 expect(constraints).toContain("明确排除的元素必须全部避免");
 expect(imagePromptConstraints.length).toBe(0);
});
