import { describe, expect, it } from "vitest";
import { buildJielongMenuText } from "./jielongText";

const plan = (over: Partial<{ date: string; occasion: "lunch" | "dinner"; dishNames: string[] }> = {}): {
  date: string;
  occasion: "lunch" | "dinner";
  dishNames: string[];
} => ({ date: "2026-07-08", occasion: "lunch", dishNames: ["红烧牛肉", "清炒时蔬", "番茄蛋汤"], ...over });

describe("buildJielongMenuText", () => {
  it("formats date(M月D日 周X) + occasion + dishes + price + tail", () => {
    const text = buildJielongMenuText(plan(), { name: "桃子", priceCents: 3000 });
    expect(text).toBe(["【桃子】7月8日 周三 午餐", "红烧牛肉、清炒时蔬、番茄蛋汤", "30元/份 · 上午10点接龙截止 · 送餐到门口", "接龙：", "1."].join("\n"));
  });

  it("dinner → 晚餐", () => {
    const text = buildJielongMenuText(plan({ occasion: "dinner" }), { name: "桃子", priceCents: 3000 });
    expect(text).toContain("晚餐");
  });

  it("dishes joined by 、 even with many", () => {
    const text = buildJielongMenuText(plan({ dishNames: ["a", "b", "c", "d", "e"] }), { name: "桃子", priceCents: 3000 });
    expect(text).toContain("a、b、c、d、e");
  });

  it("missing priceCents → ?元/份", () => {
    const text = buildJielongMenuText(plan(), { name: "桃子" });
    expect(text).toContain("?元/份");
  });

  it("missing seller name → 默认前缀", () => {
    const text = buildJielongMenuText(plan(), { name: "", priceCents: 3000 });
    expect(text.startsWith("【街坊味】")).toBe(true);
  });

  it("weekday correct for a known date (2026-07-12 is 周日)", () => {
    const text = buildJielongMenuText(plan({ date: "2026-07-12" }), { name: "桃子", priceCents: 3000 });
    expect(text).toContain("周日");
  });
});
