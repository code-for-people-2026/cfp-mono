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

  it("does NOT strip honorifics — keeps the full stored name matchable (Codex)", () => {
    // `王阿姨` stays `王阿姨` (does NOT collapse to bare `王`, which would neither
    // match `王燕萍` nor stay unique across 王-surnamed customers).
    expect(normalizeCustomerName("王阿姨")).toBe("王阿姨");
    expect(normalizeCustomerName("张师傅")).toBe("张师傅");
  });

  it("matches case variants as equal", () => {
    expect(normalizeCustomerName("lily")).toBe(normalizeCustomerName("Lily"));
    expect(normalizeCustomerName("Luye")).toBe(normalizeCustomerName("luye"));
  });
});
