import { describe, expect, it } from "vitest";
import type { Order } from "@cfp/kith-inn-v1-shared";
import { summarizeOrders } from "./summary";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 31,
  sellerId: 7,
  mealSlotId: 11,
  customerProfileId: 21,
  status: "confirmed",
  source: "manual",
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 3000,
  totalCents: 6000,
  paymentStatus: "unpaid",
  paidAt: null,
  deliveryStatus: "pending",
  deliveredAt: null,
  confirmedAt: "2026-07-10T01:00:00.000Z",
  canceledAt: null,
  note: null,
  ...overrides
});

describe("order summary", () => {
  it("counts only confirmed orders across independent payment/delivery axes", () => {
    expect(summarizeOrders([
      order(),
      order({ id: 32, quantity: 1, totalCents: 3000, paymentStatus: "paid", deliveryStatus: "done" }),
      order({ id: 33, status: "draft", quantity: 8, totalCents: 24_000, confirmedAt: null }),
      order({ id: 34, status: "canceled", quantity: 9, totalCents: 27_000, canceledAt: "2026-07-10T02:00:00.000Z" })
    ])).toEqual({ confirmedOrders: 2, totalQuantity: 3, unpaid: 1, pendingDelivery: 1 });
  });

  it("returns zeros for an empty or entirely unconfirmed list", () => {
    const empty = { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 };
    expect(summarizeOrders([])).toEqual(empty);
    expect(summarizeOrders([order({ status: "draft", confirmedAt: null })])).toEqual(empty);
  });
});
