import { describe, expect, it } from "vitest";
import type { Order } from "./types";
import { customerName, todayShanghai } from "./util";

describe("todayShanghai", () => {
  it("formats YYYY-MM-DD in Asia/Shanghai off a clock thunk (be style)", () => {
    expect(todayShanghai(() => new Date("2026-06-29T12:00:00+08:00"))).toBe("2026-06-29");
  });

  it("accepts a Date directly (fe style)", () => {
    expect(todayShanghai(new Date("2026-06-29T23:30:00Z"))).toBe("2026-06-30"); // UTC 23:30 = SHA 07:30 next day
  });

  it("rolls over at the Shanghai midnight boundary", () => {
    expect(todayShanghai(() => new Date("2026-06-29T23:30:00Z"))).toBe("2026-06-30");
  });

  it("defaults to now when no arg given (YYYY-MM-DD shape)", () => {
    expect(todayShanghai()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("customerName", () => {
  it("uses displayName when customer is populated", () => {
    const order = { customer: { id: 5, displayName: "王燕萍" } } as unknown as Order;
    expect(customerName(order)).toBe("王燕萍");
  });

  it("falls back to #id when customer is a bare id", () => {
    const order = { customer: 7 } as unknown as Order;
    expect(customerName(order)).toBe("#7");
  });
});
