import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPendingOp, completePendingOp, getCompletedOp, getPendingOp, setPendingOp, startPendingOp } from "./pendingOps";

afterEach(() => {
  clearPendingOp(1);
  clearPendingOp(2);
});

describe("pendingOps", () => {
  it("set + get + clear", () => {
    setPendingOp(1, { toolName: "mark_paid", args: { orderId: 45 }, summary: "将标记 #45 已付款" });
    expect(getPendingOp(1)).toMatchObject({ toolName: "mark_paid", args: { orderId: 45 }, summary: "将标记 #45 已付款" });
    expect(getPendingOp(1)?.opId).toEqual(expect.any(String));
    clearPendingOp(1);
    expect(getPendingOp(1)).toBeUndefined();
  });

  it("per-operator isolation", () => {
    setPendingOp(1, { toolName: "a", args: {}, summary: "A" });
    setPendingOp(2, { toolName: "b", args: {}, summary: "B" });
    expect(getPendingOp(1)?.toolName).toBe("a");
    expect(getPendingOp(2)?.toolName).toBe("b");
  });

  it("newest overwrites and mints a fresh opId", () => {
    const id1 = setPendingOp(1, { toolName: "a", args: {}, summary: "A" });
    const id2 = setPendingOp(1, { toolName: "b", args: {}, summary: "B" });
    expect(getPendingOp(1)?.toolName).toBe("b");
    expect(id2).not.toBe(id1); // newer op ⇒ different opId (stale-card guard)
  });

  it("replays only the exact completed op without clearing a newer pending op", () => {
    const doneId = setPendingOp(1, { toolName: "a", args: {}, summary: "A" });
    const nextId = setPendingOp(1, { toolName: "b", args: {}, summary: "B" });
    completePendingOp(1, doneId, "done");
    expect(getCompletedOp(1, doneId)).toEqual({ opId: doneId, reply: "done" });
    expect(getCompletedOp(1, nextId)).toBeUndefined();
    expect(getPendingOp(1)?.opId).toBe(nextId);
  });

  it("single-flights overlapping executions for the same op", () => {
    const execute = vi.fn(() => Promise.resolve("done"));
    const first = startPendingOp(1, "same", execute);
    const retry = startPendingOp(1, "same", execute);
    expect(first.joined).toBe(false);
    expect(retry).toEqual({ promise: first.promise, joined: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
