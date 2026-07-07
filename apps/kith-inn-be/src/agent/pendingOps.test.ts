import { afterEach, describe, expect, it } from "vitest";
import { clearPendingOp, getPendingOp, setPendingOp } from "./pendingOps";

afterEach(() => {
  clearPendingOp(1);
  clearPendingOp(2);
});

describe("pendingOps", () => {
  it("set + get + clear", () => {
    setPendingOp(1, { toolName: "mark_paid", args: { orderId: 45 }, summary: "将标记 #45 已付款" });
    expect(getPendingOp(1)).toEqual({ toolName: "mark_paid", args: { orderId: 45 }, summary: "将标记 #45 已付款" });
    clearPendingOp(1);
    expect(getPendingOp(1)).toBeUndefined();
  });

  it("per-operator isolation", () => {
    setPendingOp(1, { toolName: "a", args: {}, summary: "A" });
    setPendingOp(2, { toolName: "b", args: {}, summary: "B" });
    expect(getPendingOp(1)?.toolName).toBe("a");
    expect(getPendingOp(2)?.toolName).toBe("b");
  });

  it("newest overwrites", () => {
    setPendingOp(1, { toolName: "a", args: {}, summary: "A" });
    setPendingOp(1, { toolName: "b", args: {}, summary: "B" });
    expect(getPendingOp(1)?.toolName).toBe("b");
  });
});
