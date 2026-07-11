import { describe, expect, it } from "vitest";
import { orderConfirmLine } from "./orderConfirmView";

describe("orderConfirmLine", () => {
  it("shows the full service date and Chinese meal label", () => {
    expect(orderConfirmLine({ customerName: "王燕萍", date: "2026-07-13", occasion: "lunch", quantity: 2 })).toBe("2026-07-13 · 王燕萍 · 2份午餐");
    expect(orderConfirmLine({ customerName: "大龙猫", date: "2026-07-13", occasion: "dinner", quantity: 1 })).toBe("2026-07-13 · 大龙猫 · 1份晚餐");
  });
});
