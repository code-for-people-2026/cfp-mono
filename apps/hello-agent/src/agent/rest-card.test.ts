import { expect, it } from "vitest";
import { restCardConstraints, restCardDeliveryError } from "./rest-card";
const input = "请生成一张中文休息提示卡，适用于出门前；只写一句温和建议，不使用医生形象，不含联系方式。";
it("一句文案不等于只要文字，空作品和虚构/旧图片都不能算交付", () => {
 const reply = { greeting: "卡片已做好", association: "测试" };
 expect(restCardDeliveryError(input, reply, undefined, false)).toBeTruthy();
 expect(restCardDeliveryError(input, {...reply,artifacts:[{kind:"image",id:"rest",title:"休息",alt:"休息",source:{type:"media",mediaId:9}}]}, 8, false)).toBeTruthy();
 expect(restCardDeliveryError(input, {...reply,artifacts:[{kind:"image",id:"rest",title:"休息",alt:"休息",source:{type:"media",mediaId:8}}]}, 8, false)).toBeUndefined();
 expect(restCardDeliveryError(input, reply, undefined, true)).toBeUndefined();
 expect(restCardDeliveryError(input+"只要文本，不要图片", reply, undefined, false)).toBeUndefined();
});
it("保留一句、室内和禁止内容约束", () => {
 expect(restCardConstraints(input)).toContain("只能有一句");expect(restCardConstraints(input)).toContain("室内玄关");expect(restCardConstraints(input)).toContain("不出现医生");expect(restCardConstraints(input)).toContain("不出现电话号码");
});
