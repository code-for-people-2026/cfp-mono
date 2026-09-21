import { describe, expect, it } from "vitest";
import { MealSnapshotSchema, type MealSnapshot } from "@cfp/kith-inn-contracts";
import { formatMealText } from "./menu-text";

const item = (name: string, index: number) => ({ dishId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name });
function meal(overrides: Partial<MealSnapshot> = {}): MealSnapshot {
  return MealSnapshotSchema.parse({
    date: "2026-09-23", mealType: "lunch", enabled: true, soupOmitted: false,
    meat: [item("红烧肉", 1), item("清蒸鱼", 2)], vegetable: [item("清炒时蔬", 3)],
    soup: [item("紫菜蛋花汤", 4)], ...overrides
  });
}

describe("保存餐次文字", () => {
  it("按契约完整输出快照名称，分类和菜位顺序不变，不附加内部字段或价格链接", () => {
    const saved = meal();
    const before = structuredClone(saved);
    expect(formatMealText(saved)).toBe("2026年9月23日（周三）午餐\n荤：红烧肉、清蒸鱼\n素：清炒时蔬\n汤：紫菜蛋花汤");
    expect(saved).toEqual(before);
  });

  it.each([
    ["2026-12-31", "2026年12月31日（周四）"],
    ["2027-01-01", "2027年1月1日（周五）"],
    ["2028-02-29", "2028年2月29日（周二）"],
    ["2026-09-27", "2026年9月27日（周日）"]
  ])("日历日期 %s 不受本机时区影响，晚餐保留完整年份", (date, title) => {
    expect(formatMealText(meal({ date, mealType: "dinner" }))?.split("\n")[0]).toBe(`${title}晚餐`);
  });

  it("逐餐去汤不输出隐藏汤，也不清除可恢复的汤快照", () => {
    const saved = meal({ soupOmitted: true });
    const before = structuredClone(saved);
    expect(formatMealText(saved)).toBe("2026年9月23日（周三）午餐\n荤：红烧肉、清蒸鱼\n素：清炒时蔬");
    expect(saved).toEqual(before);
  });

  it("零数量分类不输出空行，支持仅汤的一餐", () => {
    expect(formatMealText(meal({ meat: [], vegetable: [] }))).toBe("2026年9月23日（周三）午餐\n汤：紫菜蛋花汤");
    expect(formatMealText(meal({ vegetable: [], soup: [] }))).toBe("2026年9月23日（周三）午餐\n荤：红烧肉、清蒸鱼");
  });

  it("停餐没有可复制文字", () => {
    expect(formatMealText(meal({ enabled: false, meat: [], vegetable: [], soup: [] }))).toBeNull();
  });

  it("重新保存后的新快照产生新文字，旧文字保持原样，完整 Unicode 菜名不截断", () => {
    const saved = meal();
    const oldText = formatMealText(saved);
    const name = "🍲".repeat(60);
    const updated = meal({ meat: [item(name, 5), saved.meat[1]!] });
    expect(formatMealText(updated)).toContain(`荤：${name}、清蒸鱼`);
    expect(oldText).toContain("荤：红烧肉、清蒸鱼");
    expect(oldText).not.toContain(name);
  });
});
