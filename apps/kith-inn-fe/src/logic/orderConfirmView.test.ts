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
    expect(orderReconciliationLine({ ...row, kind: "add", beforeQuantity: 1, changeQuantity: 2, afterQuantity: 3 })).toBe("追加 · 2026-07-13 午餐 · 王阿姨 · 当前1份 + 2份 → 共3份");
    expect(orderReconciliationLine({ ...row, kind: "set", beforeQuantity: 3 })).toBe("改量 · 2026-07-13 午餐 · 王阿姨 · 当前3份 → 改成2份");
    expect(orderReconciliationLine({ ...row, kind: "create" }, "add")).toBe("新增 · 2026-07-13 午餐 · 王阿姨 · 当前0份 + 2份 → 共2份");
  });

  it("marks confirmed business impact", () => {
    expect(orderReconciliationLine({ ...row, kind: "update", beforeQuantity: 1, orderStatus: "confirmed", affectsConfirmed: true })).toContain("影响备餐/送餐/到账记录");
  });
});

describe("orderReconciliationConflictMessage", () => {
  it("distinguishes settled orders from an expired preview", () => {
    expect(orderReconciliationConflictMessage({ error: "settled-order", message: "王阿姨的订单已标记到账，请单独处理" })).toBe("王阿姨的订单已标记到账，请单独处理");
    expect(orderReconciliationConflictMessage({ error: "settled-order" })).toBe("本次修改涉及已标记到账或已送达订单，请单独处理");
    expect(orderReconciliationConflictMessage({ error: "stale-preview", message: "订单已变化，请重新说一遍补单" })).toBe("订单已变化，请重新说一遍补单");
    expect(orderReconciliationConflictMessage({ error: "stale-preview" })).toBe("这张确认卡已过期，请重新说一遍");
    expect(orderReconciliationConflictMessage(null)).toBe("这张确认卡已过期，请重新说一遍");
  });
});
