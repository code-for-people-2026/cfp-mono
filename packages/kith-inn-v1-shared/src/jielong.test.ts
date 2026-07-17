import { describe, expect, it } from "vitest";
import { canonicalizeJielongInput, parseJielongText } from "./jielong";

describe("parseJielongText", () => {
  it("parses deterministic grammar while preserving physical row order", () => {
    const parsed = parseJielongText([
      "",
      " 2026-07-20 午餐 ",
      "1. 王阿姨 2份",
      "",
      "2、李叔 1份",
      "3） 陈 阿姨 3份"
    ].join("\r\n"));

    expect(parsed).toEqual({
      target: { date: "2026-07-20", occasion: "lunch" },
      lines: [
        { lineNumber: 3, displayName: "王阿姨", quantity: 2 },
        { lineNumber: 5, displayName: "李叔", quantity: 1 },
        { lineNumber: 6, displayName: "陈 阿姨", quantity: 3 }
      ]
    });
    expect(canonicalizeJielongInput(parsed)).toBe(
      '{"target":{"date":"2026-07-20","occasion":"lunch"},"lines":' +
      '[{"lineNumber":3,"displayName":"王阿姨","quantity":2},' +
      '{"lineNumber":5,"displayName":"李叔","quantity":1},' +
      '{"lineNumber":6,"displayName":"陈 阿姨","quantity":3}]}'
    );
  });

  it("accepts one and one hundred rows without deduplicating names", () => {
    expect(parseJielongText("2026-07-20 晚餐\n王阿姨 1份").target.occasion).toBe("dinner");
    const rows = Array.from({ length: 100 }, (_, index) => `${index + 1}) 王阿姨 1份`);
    expect(parseJielongText(["2026-07-20 午餐", ...rows].join("\n")).lines).toHaveLength(100);
  });

  it("rejects header-only, invalid headers, any invalid row and 101 rows", () => {
    for (const text of [
      " ",
      "2026-07-20 午餐\n\n",
      "2026-02-30 午餐\n王阿姨 1份",
      "2026-07-20 早餐\n王阿姨 1份",
      "2026-07-20 午餐\n1. 2份",
      "2026-07-20 午餐\n王阿姨 0份",
      "2026-07-20 午餐\n王阿姨 1.5份",
      "2026-07-20 午餐\n王阿姨 1份 备注"
    ]) expect(() => parseJielongText(text)).toThrow();

    const rows = Array.from({ length: 101 }, (_, index) => `${index + 1}. 顾客${index + 1} 1份`);
    expect(() => parseJielongText(["2026-07-20 午餐", ...rows].join("\n"))).toThrow();
  });

  it("enforces the ten-thousand-character source boundary", () => {
    const base = "2026-07-20 午餐\n王阿姨 1份";
    const maximum = base + "\n".repeat(10_000 - base.length);
    expect(parseJielongText(maximum).lines).toHaveLength(1);
    expect(() => parseJielongText(`${maximum}\n`)).toThrow();
  });
});
