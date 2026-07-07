import type { Fulfillment, Order } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import {
  byOccasion,
  gapCount,
  isCheckable,
  joinOrdersFulfillments,
  lifecycleDots,
  mealFocus,
  sortByAddress,
  toggleSelection,
  visibleRows,
} from "./ordersLifecycle";

const order = (over: Partial<Order>): Order =>
  ({ customer: 1, date: "2026-07-05", occasion: "lunch", status: "confirmed", source: "chat-paste", paymentStatus: "unpaid", seller: 7, ...over }) as Order;
const ff = (over: Partial<Fulfillment>): Fulfillment =>
  ({ serviceDate: "2026-07-05", occasion: "lunch", status: "pending", seller: 7, ...over }) as Fulfillment;

describe("joinOrdersFulfillments", () => {
  it("pairs order↔fulfillment by order.id; missing fulfillment → undefined", () => {
    const rows = joinOrdersFulfillments([order({ id: "1" }), order({ id: "2" })], [ff({ id: "f1", order: "1" })]);
    expect(rows[0]!.fulfillment?.id).toBe("f1");
    expect(rows[1]!.fulfillment).toBeUndefined();
  });

  it("handles object-type order reference on fulfillment", () => {
    const rows = joinOrdersFulfillments([order({ id: "5" })], [ff({ id: "f1", order: { id: "5" } as Order })]);
    expect(rows[0]!.fulfillment?.id).toBe("f1");
  });
});

describe("lifecycleDots", () => {
  it("delivery done/pending/none + payment paid/unpaid + base status", () => {
    expect(lifecycleDots({ order: order({ status: "confirmed" }), fulfillment: ff({ status: "done" }) })).toEqual({ base: "confirmed", delivery: "done", payment: "unpaid" });
    expect(lifecycleDots({ order: order({ status: "confirmed", paymentStatus: "paid" }), fulfillment: ff({ status: "pending" }) })).toEqual({ base: "confirmed", delivery: "pending", payment: "paid" });
    expect(lifecycleDots({ order: order({ status: "draft" }) })).toEqual({ base: "draft", delivery: "none", payment: "unpaid" });
    expect(lifecycleDots({ order: order({ status: "canceled" }) })).toEqual({ base: "canceled", delivery: "none", payment: "unpaid" });
  });
});

describe("mealFocus", () => {
  it("lunch with pending → lunch", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch" })], [ff({ order: "1", status: "pending" })]);
    expect(mealFocus(rows)).toBe("lunch");
  });
  it("lunch all done → dinner", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch" }), order({ id: "2", occasion: "dinner" })], [ff({ order: "1", status: "done" })]);
    expect(mealFocus(rows)).toBe("dinner");
  });
  it("all done → latest meal", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch" }), order({ id: "2", occasion: "dinner" })], [ff({ order: "1", status: "done" }), ff({ id: "f2", order: "2", status: "done" })]);
    expect(mealFocus(rows)).toBe("dinner");
  });

  it("lunch only all done → lunch (no dinner fallback)", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch" })], [ff({ order: "1", status: "done" })]);
    expect(mealFocus(rows)).toBe("lunch");
  });
  it("empty → null", () => {
    expect(mealFocus([])).toBeNull();
  });
});

describe("sortByAddress", () => {
  it("clusters similar addresses", () => {
    const rows = [
      { order: order({ id: "2", address: "2d03a" }) },
      { order: order({ id: "1", address: "3a27b" }) },
      { order: order({ id: "3", address: "3a18b" }) },
    ];
    const sorted = sortByAddress(rows);
    expect(sorted.map((r) => r.order.address)).toEqual(["2d03a", "3a18b", "3a27b"]);
  });

  it("undefined address → '' (sorts first)", () => {
    const rows = [{ order: order({ id: "1", address: "3a" }) }, { order: order({ id: "2" }) }];
    const sorted = sortByAddress(rows);
    expect(sorted[0]!.order.id).toBe("2");
  });
});

describe("byOccasion", () => {
  it("returns all rows for an occasion (any status)", () => {
    const rows = [
      { order: order({ id: "1", occasion: "lunch", status: "draft" }) },
      { order: order({ id: "2", occasion: "lunch", status: "confirmed" }) },
      { order: order({ id: "3", occasion: "dinner" }) },
    ];
    expect(byOccasion(rows, "lunch")).toHaveLength(2);
    expect(byOccasion(rows, "dinner")).toHaveLength(1);
  });
});

describe("gapCount", () => {
  it("counts non-canceled pending for the occasion", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch" }), order({ id: "2", occasion: "lunch", status: "canceled" }), order({ id: "3", occasion: "lunch" })],
      [ff({ order: "1", status: "pending" }), ff({ order: "2", status: "pending" }), ff({ id: "f3", order: "3", status: "done" })],
    );
    expect(gapCount(rows, "lunch")).toBe(1); // only order 1 (2 canceled, 3 done)
  });
});

describe("visibleRows", () => {
  it("no prefix → all rows for the occasion (any status)", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "3a27b" }), order({ id: "2", occasion: "dinner", address: "3a27b" })],
      [ff({ order: "1", status: "pending" }), ff({ order: "2", status: "pending" })],
    );
    expect(visibleRows(rows, "lunch", "").map((r) => r.order.id)).toEqual(["1"]);
  });

  it("prefix narrows by address (case-insensitive)", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "3A-1201" }), order({ id: "2", occasion: "lunch", address: "2d03a" })],
      [ff({ order: "1", status: "pending" }), ff({ order: "2", status: "pending" })],
    );
    expect(visibleRows(rows, "lunch", "3a").map((r) => r.order.id)).toEqual(["1"]);
  });

  it("rows with no address fall back to '' (no match with prefix, shown without)", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch" })], [ff({ order: "1", status: "pending" })]);
    expect(visibleRows(rows, "lunch", "3a")).toEqual([]); // ?? '' branch → no match
    expect(visibleRows(rows, "lunch", "").map((r) => r.order.id)).toEqual(["1"]); // no prefix → shown
  });

  it("pure-numeric fragment: building boundary + non-numeric address", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "3a27b" }), order({ id: "2", occasion: "lunch", address: "26B-301" }), order({ id: "3", occasion: "lunch", address: "隔壁小区" })],
      [ff({ order: "1", status: "pending" }), ff({ order: "2", status: "pending" }), ff({ id: "f3", order: "3", status: "pending" })],
    );
    // 3 ↔ 3a27b (building 3); not 26B-301 (building 26); not 隔壁小区 (no leading digit)
    expect(visibleRows(rows, "lunch", "3").map((r) => r.order.id)).toEqual(["1"]);
  });
});

describe("isCheckable", () => {
  it("true only for non-canceled + pending-delivery rows", () => {
    expect(isCheckable({ order: order({ status: "confirmed" }), fulfillment: ff({ status: "pending" }) })).toBe(true);
    expect(isCheckable({ order: order({ status: "confirmed" }), fulfillment: ff({ status: "done" }) })).toBe(false);
    expect(isCheckable({ order: order({ status: "canceled" }), fulfillment: ff({ status: "pending" }) })).toBe(false);
    expect(isCheckable({ order: order({ status: "draft" }) })).toBe(false); // no fulfillment → delivery none
  });
});

describe("toggleSelection", () => {
  it("adds an unselected id, removes a selected one", () => {
    expect(toggleSelection([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleSelection([1, 2, 3], 2)).toEqual([1, 3]);
    expect(toggleSelection([], 5)).toEqual([5]);
  });
});
