import { describe, expect, it } from "vitest";
import { normalizeCustomerName } from "./nameNormalize";

describe("normalizeCustomerName", () => {
  it("trims, collapses internal spaces, lowercases Latin", () => {
    expect(normalizeCustomerName("  Catherine   chen ")).toBe("catherine chen");
    expect(normalizeCustomerName("Lily")).toBe("lily");
    expect(normalizeCustomerName("Sissi-CC")).toBe("sissi-cc");
  });

  it("leaves CJK names intact (lowercase is a no-op)", () => {
    expect(normalizeCustomerName("桃子")).toBe("桃子");
    expect(normalizeCustomerName("王燕萍")).toBe("王燕萍");
    expect(normalizeCustomerName("大龙猫")).toBe("大龙猫");
  });

  it("strips honorific suffixes", () => {
    expect(normalizeCustomerName("王阿姨")).toBe("王");
    expect(normalizeCustomerName("李叔叔")).toBe("李");
    expect(normalizeCustomerName("张师傅")).toBe("张");
  });

  it("does NOT strip bare 姐/哥 (too aggressive on real names)", () => {
    expect(normalizeCustomerName("大龙猫")).toBe("大龙猫");
    expect(normalizeCustomerName("小柠檬")).toBe("小柠檬");
  });

  it("matches case variants as equal", () => {
    expect(normalizeCustomerName("lily")).toBe(normalizeCustomerName("Lily"));
    expect(normalizeCustomerName("Luye")).toBe(normalizeCustomerName("luye"));
  });
});
