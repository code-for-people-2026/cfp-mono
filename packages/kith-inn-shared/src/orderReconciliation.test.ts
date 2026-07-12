import { describe, expect, it } from "vitest";
import { fingerprintActiveOrders } from "./orderReconciliation";

describe("fingerprintActiveOrders", () => {
  it("normalizes relationship shapes, orders, items and absent prices", () => {
    const first = {
      id: 2, customer: { id: 12 }, date: "2026-07-13", occasion: "lunch", status: "draft", paymentStatus: "unpaid", updatedAt: "t2",
      items: [{ id: 22, offering: { id: 9 }, quantity: 2 }, { id: 21, offering: 9, quantity: 1, unitPriceCents: 3000 }],
    };
    const second = {
      id: 1, customer: 13, date: "2026-07-13", occasion: "lunch", status: "confirmed", paymentStatus: "paid", updatedAt: "t1",
      items: [{ id: 20, offering: 9, quantity: 1, unitPriceCents: 3000 }],
    };
    expect(fingerprintActiveOrders([first, second])).toBe(fingerprintActiveOrders([
      second,
      { ...first, customer: 12, date: "2026-07-13T00:00:00.000Z", items: [...first.items].reverse() },
    ]));
    expect(fingerprintActiveOrders([first])).not.toBe(fingerprintActiveOrders([{ ...first, updatedAt: "changed" }]));
  });
});
