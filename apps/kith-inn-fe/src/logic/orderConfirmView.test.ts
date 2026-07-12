import { describe, expect, it } from "vitest";
import { orderConfirmLine, orderReconciliationConflictMessage, orderReconciliationLine } from "./orderConfirmView";

describe("orderConfirmLine", () => {
  it("shows the full service date and Chinese meal label", () => {
    expect(orderConfirmLine({ customerName: "王燕萍", date: "2026-07-13", occasion: "lunch", quantity: 2 })).toBe("2026-07-13 · 王燕萍 · 2份午餐");
    expect(orderConfirmLine({ customerName: "大龙猫", date: "2026-07-13", occasion: "dinner", quantity: 1 })).toBe("2026-07-13 · 大龙猫 · 1份晚餐");
  });
});

describe("orderReconciliationLine", () => {
  const row = { customerName: "王阿姨", date: "2026-07-13", occasion: "lunch" as const, afterQuantity: 2, affectsConfirmed: false };

  it("shows create, update, cancel and unchanged without exposing source", () => {
    expect(orderReconciliationLine({ ...row, kind: "create" })).toBe("新增 · 2026-07-13 午餐 · 王阿姨 · 2份");
    expect(orderReconciliationLine({ ...row, kind: "update", beforeQuantity: 1 })).toBe("更新 · 2026-07-13 午餐 · 王阿姨 · 1 → 2份");
    expect(orderReconciliationLine({ ...row, kind: "cancel", beforeQuantity: 3, afterQuantity: 0 })).toBe("取消 · 2026-07-13 午餐 · 王阿姨 · 3 → 0份");
    expect(orderReconciliationLine({ ...row, kind: "unchanged", beforeQuantity: 2 })).toBe("不变 · 2026-07-13 午餐 · 王阿姨 · 2份");
    expect(orderReconciliationLine({ ...row, kind: "add", changeQuantity: 2 })).toBe("追加 · 2026-07-13 午餐 · 王阿姨 · 0 → 2份");
  });

  it("marks confirmed business impact", () => {
    expect(orderReconciliationLine({ ...row, kind: "update", beforeQuantity: 1, orderStatus: "confirmed", affectsConfirmed: true })).toContain("影响备餐/送餐/收款");
  });
});

describe("orderReconciliationConflictMessage", () => {
  it("distinguishes settled orders from an expired preview", () => {
    expect(orderReconciliationConflictMessage({ error: "settled-order", message: "王阿姨的订单已付款，请单独处理" })).toBe("王阿姨的订单已付款，请单独处理");
    expect(orderReconciliationConflictMessage({ error: "settled-order" })).toBe("接龙涉及已付款或已送达订单，请单独处理");
    expect(orderReconciliationConflictMessage({ error: "stale-preview" })).toBe("这张确认卡已过期，请重新说一遍");
    expect(orderReconciliationConflictMessage(null)).toBe("这张确认卡已过期，请重新说一遍");
  });
});
