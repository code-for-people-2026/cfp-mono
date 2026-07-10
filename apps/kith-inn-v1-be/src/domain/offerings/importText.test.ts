import { describe, expect, it } from "vitest";
import type { Offering } from "@cfp/kith-inn-v1-shared";
import { ImportTextError, conflictActionFor, parseImportText, previewImport } from "./importText";

const existing: Offering[] = [{
  id: 10,
  sellerId: 7,
  name: "番茄牛腩",
  mainIngredient: "牛肉",
  category: "meat",
  active: true
}];

describe("parseImportText", () => {
  it("ignores empty lines, preserves line numbers and supports common separators/categories", () => {
    expect(parseImportText([
      "番茄牛腩 牛肉 荤",
      "",
      "清炒时蔬,青菜,素",
      "紫菜蛋花汤，鸡蛋，汤",
      "红烧肉\t猪肉\tmeat",
      "拍黄瓜|黄瓜|veg",
      "菌菇汤；菌菇；soup",
      "凉拌豆腐 素菜"
    ].join("\n"))).toEqual([
      { line: 1, raw: "番茄牛腩 牛肉 荤", parsed: { name: "番茄牛腩", mainIngredient: "牛肉", category: "meat" } },
      { line: 3, raw: "清炒时蔬,青菜,素", parsed: { name: "清炒时蔬", mainIngredient: "青菜", category: "veg" } },
      { line: 4, raw: "紫菜蛋花汤，鸡蛋，汤", parsed: { name: "紫菜蛋花汤", mainIngredient: "鸡蛋", category: "soup" } },
      { line: 5, raw: "红烧肉\t猪肉\tmeat", parsed: { name: "红烧肉", mainIngredient: "猪肉", category: "meat" } },
      { line: 6, raw: "拍黄瓜|黄瓜|veg", parsed: { name: "拍黄瓜", mainIngredient: "黄瓜", category: "veg" } },
      { line: 7, raw: "菌菇汤；菌菇；soup", parsed: { name: "菌菇汤", mainIngredient: "菌菇", category: "soup" } },
      { line: 8, raw: "凉拌豆腐 素菜", parsed: { name: "凉拌豆腐", mainIngredient: null, category: "veg" } }
    ]);
  });

  it("reports long fields, unknown categories, missing fields and duplicate delimiters per line", () => {
    const rows = parseImportText([
      `${"菜".repeat(81)} 荤`,
      `菜 ${"料".repeat(81)} 素`,
      "神秘菜 海鲜",
      "只有菜名",
      "番茄牛腩,,荤",
      "菜 主料 额外 素"
    ].join("\n"));
    expect(rows).toEqual([
      expect.objectContaining({ line: 1, error: "菜名不能超过 80 个字符" }),
      expect.objectContaining({ line: 2, error: "主料不能超过 80 个字符" }),
      expect.objectContaining({ line: 3, error: "无法识别分类“海鲜”" }),
      expect.objectContaining({ line: 4, error: "每行需要菜名和分类" }),
      expect.objectContaining({ line: 5, error: "分隔符之间不能有空字段" }),
      expect.objectContaining({ line: 6, error: "每行最多包含菜名、主料和分类" })
    ]);
  });

  it("enforces at most 50 non-empty rows", () => {
    const fiftyRows = Array.from({ length: 50 }, (_, index) => `菜${index} 素`).join("\n");
    const startedAt = performance.now();
    expect(previewImport(fiftyRows, [])).toEqual(expect.objectContaining({
      summary: { ready: 50, conflict: 0, invalid: 0 }
    }));
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(() => parseImportText(Array.from({ length: 51 }, (_, index) => `菜${index} 素`).join("\n")))
      .toThrow(new ImportTextError("too-many-import-rows", "一次最多导入 50 行"));
  });
});

describe("previewImport", () => {
  it("marks current-seller name conflicts as default skip and duplicate input as invalid", () => {
    expect(previewImport("番茄牛腩 牛肉 荤\n新菜 青菜 素\n新菜 青菜 素", existing)).toEqual({
      rows: [
        {
          line: 1,
          raw: "番茄牛腩 牛肉 荤",
          parsed: { name: "番茄牛腩", mainIngredient: "牛肉", category: "meat" },
          status: "conflict",
          existingId: 10,
          defaultAction: "skip"
        },
        {
          line: 2,
          raw: "新菜 青菜 素",
          parsed: { name: "新菜", mainIngredient: "青菜", category: "veg" },
          status: "ready",
          defaultAction: "create"
        },
        { line: 3, raw: "新菜 青菜 素", status: "invalid", error: "本次文本内菜名重复" }
      ],
      summary: { ready: 1, conflict: 1, invalid: 1 }
    });
  });

  it("uses skip unless overwrite is explicit for that line", () => {
    expect(conflictActionFor(2, [])).toBe("skip");
    expect(conflictActionFor(2, [{ line: 2, action: "overwrite" }])).toBe("overwrite");
    expect(conflictActionFor(3, [{ line: 2, action: "overwrite" }])).toBe("skip");
  });
});
