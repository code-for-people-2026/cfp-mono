import { describe, expect, it } from "vitest";
import { cycleCategory, labels, previewDishes } from "./classify";

describe("菜品分类预览", () => {
  it("汤羹优先于荤菜关键词，其余建议为素菜", () => {
    const meatNames = ["肉", "排骨", "牛", "羊", "鸡", "鸭", "鹅", "鱼", "虾", "蟹", "丸", "腊肠"];
    expect(previewDishes(["牛肉汤", "蟹羹", ...meatNames, "青菜"].join("\n")).map((dish) => dish.category))
      .toEqual(["soup", "soup", ...meatNames.map(() => "meat"), "vegetable"]);
    expect(labels).toEqual({ meat: "荤", vegetable: "素", soup: "汤" });
    expect([cycleCategory("meat"), cycleCategory("vegetable"), cycleCategory("soup")])
      .toEqual(["vegetable", "soup", "meat"]);
  });

  it("返回改名再预览保留同名菜的手动分类，新名字重新建议且不修改旧草稿", () => {
    const previous = previewDishes("牛肉汤\n青菜\ne\u0301");
    previous[0]!.category = "meat";
    previous[1]!.category = "soup";
    previous[2]!.category = "meat";
    expect(previewDishes(" 牛肉汤 \r\n白菜\ré\n\n", previous)).toEqual([
      { name: "牛肉汤", category: "meat" }, { name: "白菜", category: "vegetable" }, { name: "é", category: "meat" }
    ]);
    expect(previous[1]).toEqual({ name: "青菜", category: "soup" });
    expect(previewDishes("é", [{ name: " e\u0301 ", category: "soup" }])[0]?.category).toBe("soup");
  });

  it("规范化后整批拒绝重名并列出重复名称", () => {
    expect(() => previewDishes(" e\u0301 \né\n青菜\n 青菜 ")).toThrow("菜名重复：é、青菜");
  });

  it("按 Unicode 字符计数，接受 60 个 emoji 并拒绝 61 个", () => {
    expect(previewDishes("😀".repeat(60))[0]?.name).toBe("😀".repeat(60));
    expect(() => previewDishes("😀".repeat(61))).toThrow("1～60");
  });

  it.each(["青\u0000菜", "青\t菜", "青\u2028菜", "青\u2029菜"])("拒绝控制或分隔字符：%j", (name) => {
    expect(() => previewDishes(name)).toThrow("不含控制字符或分隔符");
  });

  it("接受 200 道且拒绝空输入和 201 道，不截断", () => {
    const names = Array.from({ length: 201 }, (_, index) => `菜${index}`);
    expect(previewDishes(names.slice(0, 200).join("\n"))).toHaveLength(200);
    expect(() => previewDishes(names.join("\n"))).toThrow("最多录入 200 道");
    expect(() => previewDishes(" \r\n\n ")).toThrow("至少输入一道菜");
  });
});
