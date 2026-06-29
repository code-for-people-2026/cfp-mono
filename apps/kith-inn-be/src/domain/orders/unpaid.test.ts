import type { Order } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import { unpaidSummary } from "./unpaid";

const order = (over: Partial<Order>): Order =>
  ({ id: 1, customer: 1, date: "2026-06-30", status: "confirmed", source: "chat-paste", paymentStatus: "unpaid", seller: 7, ...over }) as Order;

describe("unpaidSummary", () => {
  it("filters unpaid, sums totalCents", () => {
    const r = unpaidSummary([
      order({ id: 1, paymentStatus: "unpaid", totalCents: 3000 }),
      order({ id: 2, paymentStatus: "paid", totalCents: 3000 }),
      order({ id: 3, paymentStatus: "unpaid", totalCents: 6000 }),
    ]);
    expect(r.count).toBe(2);
    expect(r.totalCents).toBe(9000);
    expect(r.orders.map((o) => o.id)).toEqual([1, 3]);
  });

  it("treats missing totalCents as 0", () => {
    const r = unpaidSummary([order({ id: 1, paymentStatus: "unpaid" })]);
    expect(r.totalCents).toBe(0);
  });

  it("returns empty when all paid/reconciled", () => {
    expect(unpaidSummary([order({ paymentStatus: "paid" }), order({ paymentStatus: "reconciled" })]).count).toBe(0);
  });
});
