import { describe, expect, it } from "vitest";
import { buildJielongMenuText, type JielongPlan } from "./jielongText";

const plan = (over: Partial<JielongPlan> = {}): JielongPlan => ({
  date: "2026-07-08",
  occasion: "lunch",
  dishNames: ["红烧牛肉", "清炒时蔬", "番茄蛋汤"],
  ...over,
});

describe("buildJielongMenuText", () => {
  it("single meal: #接龙 header + date + numbered dishes + 例 + 1.", () => {
    const text = buildJielongMenuText([plan()], { name: "桃子", priceCents: 3000 });
    expect(text).toBe([
      "#接龙",
      "7.8号星期三午餐预定接龙（30元）",
      "  1.红烧牛肉",
      "  2.清炒时蔬",
      "  3.番茄蛋汤",
      "例 桃子   1份午餐",
      "",
      "1.",
    ].join("\n"));
  });

  it("two meals combined into one接龙", () => {
    const text = buildJielongMenuText(
      [plan(), plan({ occasion: "dinner", dishNames: ["香菇滑鸡", "炒茄子"] })],
      { name: "桃子", priceCents: 3000 },
    );
    expect(text).toContain("7.8号星期三午餐预定接龙（30元）");
    expect(text).toContain("7.8号星期三晚餐预定接龙（30元）");
    expect(text).toContain("例 桃子   1份午餐晚餐");
    expect(text.startsWith("#接龙")).toBe(true);
  });

  it("dinner only → 例 line says 晚餐", () => {
    const text = buildJielongMenuText([plan({ occasion: "dinner" })], { name: "桃子", priceCents: 3000 });
    expect(text).toContain("例 桃子   1份晚餐");
  });

  it("missing priceCents → ?元", () => {
    const text = buildJielongMenuText([plan()], { name: "桃子" });
    expect(text).toContain("（?元）");
  });

  it("weekday correct for a known date (2026-07-12 is 周日)", () => {
    const text = buildJielongMenuText([plan({ date: "2026-07-12" })], { name: "桃子", priceCents: 3000 });
    expect(text).toContain("7.12号星期日");
  });
});
