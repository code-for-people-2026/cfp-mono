import type { Order } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import { unpaidSummary } from "./unpaid";

const order = (over: Partial<Order>): Order =>
  ({ id: 1, customer: 1, date: "2026-06-30", status: "confirmed", source: "chat-paste", paymentStatus: "unpaid", seller: 7, ...over }) as Order;

describe("unpaidSummary", () => {
  it("counts confirmed+unpaid, sums totalCents; excludes draft/canceled (Codex)", () => {
    const r = unpaidSummary([
      order({ id: 1, status: "confirmed", paymentStatus: "unpaid", totalCents: 3000 }),
      order({ id: 2, status: "confirmed", paymentStatus: "paid", totalCents: 3000 }),
      order({ id: 3, status: "confirmed", paymentStatus: "unpaid", totalCents: 6000 }),
      order({ id: 4, status: "draft", paymentStatus: "unpaid", totalCents: 9000 }), // draft → excluded
      order({ id: 5, status: "canceled", paymentStatus: "unpaid", totalCents: 9000 }), // canceled → excluded
    ]);
    expect(r.count).toBe(2);
    expect(r.totalCents).toBe(9000);
    expect(r.orders.map((o) => o.id)).toEqual([1, 3]);
  });

  it("treats missing totalCents as 0", () => {
    const r = unpaidSummary([order({ id: 1, status: "confirmed", paymentStatus: "unpaid" })]);
    expect(r.totalCents).toBe(0);
  });

  it("returns empty when all paid/reconciled", () => {
    expect(unpaidSummary([order({ status: "confirmed", paymentStatus: "paid" }), order({ status: "confirmed", paymentStatus: "reconciled" })]).count).toBe(0);
  });
});
