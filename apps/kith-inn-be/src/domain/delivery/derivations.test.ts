import type { Fulfillment, MenuPlan, Order } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import { fulfillmentsMatchingAddress, gapReport, nearestMeal, packingSort, todayGaps } from "./derivations";

// Address now lives on the ORDER (frozen snapshot); cms populates orderItem→order.
const at = (address?: string): Fulfillment["orderItem"] =>
  ({ id: 1, order: { id: 1, address } }) as never;

const f = (over: Partial<Fulfillment> = {}): Fulfillment =>
  ({ id: 1, orderItem: at("3A"), serviceDate: "2026-06-30", mode: "delivery", status: "pending", seller: 7, ...over }) as Fulfillment;

describe("packingSort", () => {
  it("groups by order address, counts, sorts by count desc then address", () => {
    const fs = [
      f({ id: 1, orderItem: at("3A") }),
      f({ id: 2, orderItem: at("3A") }),
      f({ id: 3, orderItem: at("26B") }),
      f({ id: 4, orderItem: at("1D") }),
      f({ id: 5, orderItem: at("1D") }),
      f({ id: 6, orderItem: at("1D") }),
    ];
    const groups = packingSort(fs);
    expect(groups.map((g) => `${g.address}×${g.count}`)).toEqual(["1D×3", "3A×2", "26B×1"]);
  });

  it("treats missing/blank order address as （无地址）", () => {
    const groups = packingSort([f({ id: 1, orderItem: at() }), f({ id: 2, orderItem: at("  ") })]);
    expect(groups[0]!.address).toBe("（无地址）");
    expect(groups[0]!.count).toBe(2);
  });
});

describe("gapReport", () => {
  it("counts pending + handed-off only (done/canceled excluded)", () => {
    const fs = [
      f({ id: 1, orderItem: at("3A"), status: "pending" }),
      f({ id: 2, orderItem: at("3A"), status: "done" }),
      f({ id: 3, orderItem: at("26B"), status: "handed-off" }),
      f({ id: 4, orderItem: at("1D"), status: "canceled" }),
    ];
    const r = gapReport(fs);
    expect(r.totalPending).toBe(2); // 3A pending + 26B handed-off
    expect(r.gaps).toContainEqual({ address: "3A", pending: 1 });
    expect(r.gaps).toContainEqual({ address: "26B", pending: 1 });
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

  it("counts draft orders, pending fulfillments, confirmed-unpaid, draft menus", () => {
    // draft/canceled orders default to paymentStatus "unpaid" but must NOT count as 未付 (Codex).
    const r = todayGaps({
      orders: [
        order({ id: 1, status: "confirmed", paymentStatus: "unpaid" }), // confirmed unpaid → counts
        order({ id: 2, status: "confirmed", paymentStatus: "paid" }),
        order({ id: 3, status: "draft", paymentStatus: "unpaid" }), // draft → unconfirmed, NOT unpaid
        order({ id: 4, status: "canceled", paymentStatus: "unpaid" }), // canceled → neither
      ],
      fulfillments: [f({ status: "pending" }), f({ status: "done" }), f({ status: "handed-off" })],
      menuPlans: [mp({ status: "draft" }), mp({ status: "published" })],
    });
    expect(r).toEqual({ unconfirmedOrders: 1, pendingDeliveries: 2, unpaidOrders: 1, unpublishedMenus: 1 });
  });
});

describe("fulfillmentsMatchingAddress", () => {
  it("returns open fulfillments whose order address contains the fragment", () => {
    const fs = [
      f({ id: 11, orderItem: at("26B-301") }),
      f({ id: 12, orderItem: at("26B-502"), status: "handed-off" }),
      f({ id: 13, orderItem: at("26B-301"), status: "done" }), // done → skip
      f({ id: 14, orderItem: at("1D") }),
    ];
    expect(fulfillmentsMatchingAddress(fs, "26B").map((x) => x.id)).toEqual([11, 12]);
  });

  it("narrows when the fragment is more specific", () => {
    const fs = [f({ id: 11, orderItem: at("26B-301") }), f({ id: 12, orderItem: at("26B-502") })];
    expect(fulfillmentsMatchingAddress(fs, "26B-301").map((x) => x.id)).toEqual([11]);
  });

  it("blank fragment → [] (prevents marking everything done)", () => {
    const fs = [f({ orderItem: at("1D") })];
    expect(fulfillmentsMatchingAddress(fs, "")).toEqual([]);
    expect(fulfillmentsMatchingAddress(fs, "  ")).toEqual([]);
  });
});
