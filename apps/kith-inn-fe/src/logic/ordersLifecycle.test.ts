import type { Fulfillment, Order } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import {
  byOccasion,
  gapCount,
  joinOrdersFulfillments,
  lifecycleDots,
  mealFocus,
  previewAddressMatch,
  sortByAddress,
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

describe("previewAddressMatch", () => {
  it("returns current-meal pending non-canceled matching the fragment", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "3a27b" }), order({ id: "2", occasion: "lunch", address: "2d03a" }), order({ id: "3", occasion: "lunch", address: "3a18b", status: "canceled" })],
      [ff({ order: "1", status: "pending" }), ff({ order: "2", status: "pending" }), ff({ id: "f3", order: "3", status: "pending" })],
    );
    const matched = previewAddressMatch(rows, "lunch", "3a");
    expect(matched.map((r) => r.order.id)).toEqual(["1"]); // not 2 (2d), not 3 (canceled)
  });
  it("excludes done and non-matching occasion", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "3a27b" }), order({ id: "2", occasion: "dinner", address: "3a27b" })],
      [ff({ order: "1", status: "done" }), ff({ order: "2", status: "pending" })],
    );
    expect(previewAddressMatch(rows, "lunch", "3a")).toEqual([]);
    expect(previewAddressMatch(rows, "dinner", "3a")).toHaveLength(1);
  });

  it("handles rows with no address (?? '' fallback)", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch" })], [ff({ order: "1", status: "pending" })]);
    expect(previewAddressMatch(rows, "lunch", "x")).toEqual([]);
  });

  it("pure-numeric fragment: building boundary (3 ≠ 26)", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "3a27b" }), order({ id: "2", occasion: "lunch", address: "26B-301" })],
      [ff({ order: "1", status: "pending" }), ff({ order: "2", status: "pending" })],
    );
    expect(previewAddressMatch(rows, "lunch", "3").map((r) => r.order.id)).toEqual(["1"]);
  });

  it("pure-numeric fragment vs non-numeric address (隔壁小区, no leading digit)", () => {
    const rows = joinOrdersFulfillments(
      [order({ id: "1", occasion: "lunch", address: "隔壁小区" })],
      [ff({ order: "1", status: "pending" })],
    );
    expect(previewAddressMatch(rows, "lunch", "3")).toEqual([]); // no leading digit → no match
  });

  it("blank fragment → no match", () => {
    const rows = joinOrdersFulfillments([order({ id: "1", occasion: "lunch", address: "3a" })], [ff({ order: "1", status: "pending" })]);
    expect(previewAddressMatch(rows, "lunch", "")).toEqual([]);
    expect(previewAddressMatch(rows, "lunch", "  ")).toEqual([]);
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
