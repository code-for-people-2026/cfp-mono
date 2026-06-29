import type { Fulfillment, MenuPlan, Order } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import { gapReport, nearestMeal, packingSort, todayGaps } from "./derivations";

const f = (over: Partial<Fulfillment> = {}): Fulfillment =>
  ({ id: 1, orderItem: 1, serviceDate: "2026-06-30", mode: "delivery", status: "pending", seller: 7, ...over }) as Fulfillment;

describe("packingSort", () => {
  it("groups by building, counts, sorts by count desc then building", () => {
    const fs = [
      f({ id: 1, addrBuilding: "3A" }),
      f({ id: 2, addrBuilding: "3A" }),
      f({ id: 3, addrBuilding: "26B" }),
      f({ id: 4, addrBuilding: "1D" }),
      f({ id: 5, addrBuilding: "1D" }),
      f({ id: 6, addrBuilding: "1D" }),
    ];
    const groups = packingSort(fs);
    expect(groups.map((g) => `${g.building}×${g.count}`)).toEqual(["1D×3", "3A×2", "26B×1"]);
  });

  it("treats missing building as （无楼栋）", () => {
    const groups = packingSort([f({ id: 1 }), f({ id: 2, addrBuilding: "  " })]);
    expect(groups[0]!.building).toBe("（无楼栋）");
    expect(groups[0]!.count).toBe(2);
  });
});

describe("gapReport", () => {
  it("counts pending + handed-off only (done/canceled excluded)", () => {
    const fs = [
      f({ id: 1, addrBuilding: "3A", status: "pending" }),
      f({ id: 2, addrBuilding: "3A", status: "done" }),
      f({ id: 3, addrBuilding: "26B", status: "handed-off" }),
      f({ id: 4, addrBuilding: "1D", status: "canceled" }),
    ];
    const r = gapReport(fs);
    expect(r.totalPending).toBe(2); // 3A pending + 26B handed-off
    expect(r.gaps).toContainEqual({ building: "3A", pending: 1 });
    expect(r.gaps).toContainEqual({ building: "26B", pending: 1 });
  });

  it("returns empty when all delivered/canceled", () => {
    expect(gapReport([f({ status: "done" }), f({ status: "canceled" })])).toMatchObject({ totalPending: 0, gaps: [] });
  });
});

describe("nearestMeal", () => {
  it("morning (<12) → today lunch", () => {
    expect(nearestMeal(9)).toEqual({ day: "today", meals: ["lunch"] });
  });
  it("afternoon (12–17) → today dinner", () => {
    expect(nearestMeal(15)).toEqual({ day: "today", meals: ["dinner"] });
  });
  it("evening (≥17) → tomorrow lunch+dinner", () => {
    expect(nearestMeal(20)).toEqual({ day: "tomorrow", meals: ["lunch", "dinner"] });
  });
});

describe("todayGaps", () => {
  const order = (over: Partial<Order>): Order =>
    ({ id: 1, customer: 1, date: "2026-06-30", status: "draft", source: "chat-paste", paymentStatus: "unpaid", seller: 7, ...over }) as Order;
  const mp = (over: Partial<MenuPlan>): MenuPlan =>
    ({ id: 1, slot: 1, offerings: [], status: "draft", seller: 7, ...over }) as MenuPlan;

  it("counts draft orders, pending fulfillments, unpaid, draft menus", () => {
    const r = todayGaps({
      orders: [order({ id: 1, status: "draft" }), order({ id: 2, status: "confirmed", paymentStatus: "paid" }), order({ id: 3, status: "draft", paymentStatus: "unpaid" })],
      fulfillments: [f({ status: "pending" }), f({ status: "done" }), f({ status: "handed-off" })],
      menuPlans: [mp({ status: "draft" }), mp({ status: "published" })],
    });
    expect(r).toEqual({ unconfirmedOrders: 2, pendingDeliveries: 2, unpaidOrders: 2, unpublishedMenus: 1 });
  });
});
