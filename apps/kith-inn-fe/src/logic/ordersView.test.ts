import { describe, expect, it } from "vitest";
import type { Order } from "@cfp/kith-inn-shared";
import { customerName, orderStatusDot, yuan } from "./ordersView";

const order = (over: Partial<Order>): Order =>
  ({
    id: 1,
    customer: { id: 5, displayName: "王燕萍", kind: "regular" },
    date: "2026-06-30",
    status: "confirmed",
    source: "chat-paste",
    paymentStatus: "unpaid",
    ...over,
  }) as Order;

describe("orderStatusDot", () => {
  it("confirmed + paid → 收(green)", () => {
    expect(orderStatusDot(order({ paymentStatus: "paid" }))).toEqual({ label: "收", tone: "green" });
  });
  it("confirmed + reconciled → 收(green) too (not 欠)", () => {
    expect(orderStatusDot(order({ paymentStatus: "reconciled" }))).toEqual({ label: "收", tone: "green" });
  });
  it("confirmed + unpaid → 欠(red)", () => {
    expect(orderStatusDot(order({ paymentStatus: "unpaid" }))).toEqual({ label: "欠", tone: "red" });
  });
  it("draft → 草(amber)", () => {
    expect(orderStatusDot(order({ status: "draft" }))).toEqual({ label: "草", tone: "amber" });
  });
  it("canceled → 废(muted)", () => {
    expect(orderStatusDot(order({ status: "canceled" }))).toEqual({ label: "废", tone: "muted" });
  });
});

describe("customerName", () => {
  it("reads displayName from the populated customer", () => {
    expect(customerName(order({}))).toBe("王燕萍");
  });
  it("falls back to #id when customer is an id", () => {
    expect(customerName(order({ customer: 9 }) as Order)).toBe("#9");
  });
});

describe("yuan", () => {
  it("formats cents as ¥N", () => {
    expect(yuan(3000)).toBe("¥30");
    expect(yuan(0)).toBe("¥0");
  });
  it("shows — when totalCents is missing", () => {
    expect(yuan(undefined)).toBe("—");
  });
});
