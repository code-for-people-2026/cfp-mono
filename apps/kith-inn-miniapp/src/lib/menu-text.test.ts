import { describe, expect, it } from "vitest";
import { MealSnapshotSchema, type MealSnapshot } from "@cfp/kith-inn-contracts";
import { formatMealExample, formatMealText } from "./menu-text";

const item = (name: string, index: number) => ({ dishId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name });
function meal(overrides: Partial<MealSnapshot> = {}): MealSnapshot {
  return MealSnapshotSchema.parse({
    date: "2026-09-23", mealType: "lunch", enabled: true, soupOmitted: false,
    meat: [item("红烧肉", 1), item("清蒸鱼", 2)], vegetable: [item("清炒时蔬", 3)],
    soup: [item("紫菜蛋花汤", 4)], ...overrides
  });
}

describe("保存餐次的接龙说明与填写示例", () => {
  it("默认30元，快照名称按荤素汤连续编号，不附加内部字段或已有报名", () => {
    const saved = meal();
    const before = structuredClone(saved);
    expect(formatMealText(saved)).toBe("9.23号星期三午餐预定接龙（30元）\n1.红烧肉\n2.清蒸鱼\n3.清炒时蔬\n4.紫菜蛋花汤");
    expect(saved).toEqual(before);
  });

  it("接龙说明只生成日期餐次价格与菜品，不混入填写示例", () => {
    expect(formatMealText(meal({ date: "2026-09-22", mealType: "dinner",
      meat: [item("煎鸡中翅", 1), item("红烧肉", 2)], vegetable: [item("焗小土豆", 3), item("炒青菜", 4)], soup: []
    }))).toBe("9.22号星期二晚餐预定接龙（30元）\n1.煎鸡中翅\n2.红烧肉\n3.焗小土豆\n4.炒青菜");
  });

  it("填写示例跟随午晚餐，独立输出且不带接龙标记、示例前缀或已有报名", () => {
    const saved = meal();
    const before = structuredClone(saved);
    expect(formatMealExample(saved)).toBe("1份午餐");
    expect(formatMealExample(meal({ mealType: "dinner" }))).toBe("1份晚餐");
    expect(saved).toEqual(before);
  });

  it.each([
    ["2026-09-30", "9.30号星期三"],
    ["2026-10-01", "10.1号星期四"],
    ["2026-12-31", "12.31号星期四"],
    ["2027-01-01", "1.1号星期五"],
    ["2028-02-29", "2.29号星期二"],
    ["2026-09-27", "9.27号星期日"]
  ])("日历日期 %s 的星期按真实日期计算，短日期不受本机时区影响", (date, title) => {
    expect(formatMealText(meal({ date, mealType: "dinner" }))?.split("\n")[0]).toBe(`${title}晚餐预定接龙（30元）`);
  });

  it("逐餐去汤不输出隐藏汤或空编号，也不清除可恢复的汤快照", () => {
    const saved = meal({ soupOmitted: true });
    const before = structuredClone(saved);
    expect(formatMealText(saved)).toBe("9.23号星期三午餐预定接龙（30元）\n1.红烧肉\n2.清蒸鱼\n3.清炒时蔬");
    expect(saved).toEqual(before);
  });

  it("零数量分类不输出空行且编号从1开始，支持仅汤的一餐", () => {
    expect(formatMealText(meal({ meat: [], vegetable: [] }))).toBe("9.23号星期三午餐预定接龙（30元）\n1.紫菜蛋花汤");
    expect(formatMealText(meal({ vegetable: [], soup: [] }))).toBe("9.23号星期三午餐预定接龙（30元）\n1.红烧肉\n2.清蒸鱼");
  });

  it("停餐没有可复制文字", () => {
    expect(formatMealText(meal({ enabled: false, meat: [], vegetable: [], soup: [] }))).toBeNull();
  });

  it("重新保存后的新快照产生新文字，旧文字保持原样，完整 Unicode 菜名不截断", () => {
    const saved = meal();
    const oldText = formatMealText(saved);
    const name = "🍲".repeat(60);
    const updated = meal({ meat: [item(name, 5), saved.meat[1]!] });
    expect(formatMealText(updated)).toContain(`1.${name}\n2.清蒸鱼`);
    expect(oldText).toContain("1.红烧肉\n2.清蒸鱼");
    expect(oldText).not.toContain(name);
  });
});
