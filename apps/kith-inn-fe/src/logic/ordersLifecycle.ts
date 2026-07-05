import type { Fulfillment, Order } from "@cfp/kith-inn-shared";

// ponytail: inlined copy of addressMatches (shared has the canonical one for be/Node;
// FE can't value-import shared .ts via Taro webpack — only type imports are stripped).
// Keep in sync with packages/kith-inn-shared/src/addressMatch.ts.
function addressMatches(address: string, fragment: string): boolean {
  const a = fragment.trim();
  if (!a) return false;
  if (/^\d+$/.test(a)) {
    const m = address.match(/^\d+/);
    return m !== null && m[0] === a;
  }
  return address.startsWith(a);
}

export type Occasion = "lunch" | "dinner";
export type Row = { order: Order; fulfillment?: Fulfillment };

/** Pair orders with their fulfillment (by order.id); draft/canceled orders may have none. */
export function joinOrdersFulfillments(orders: Order[], fulfillments: Fulfillment[]): Row[] {
  const fmap = new Map<string | number, Fulfillment>();
  for (const f of fulfillments) {
    const oid = typeof f.order === "object" ? f.order.id : f.order;
    if (oid !== undefined) fmap.set(oid, f);
  }
  return orders.map((order) => ({ order, fulfillment: fmap.get(order.id) }));
}

/** Two-axis lifecycle: 履约 (delivery) + 付款 (payment), independent. base = order.status. */
export function lifecycleDots(row: Row): {
  base: "draft" | "confirmed" | "canceled";
  delivery: "pending" | "done" | "none";
  payment: "unpaid" | "paid";
} {
  return {
    base: row.order.status,
    delivery: row.fulfillment?.status === "done" ? "done" : row.fulfillment?.status === "pending" ? "pending" : "none",
    payment: row.order.paymentStatus === "paid" || row.order.paymentStatus === "reconciled" ? "paid" : "unpaid",
  };
}

/** Default focus: earliest meal (lunch→dinner) with pending delivery; all done → latest existing. */
export function mealFocus(rows: Row[]): Occasion | null {
  for (const occ of ["lunch", "dinner"] as Occasion[]) {
    if (byOccasion(rows, occ).some((r) => lifecycleDots(r).delivery === "pending")) return occ;
  }
  for (const occ of ["dinner", "lunch"] as Occasion[]) {
    if (byOccasion(rows, occ).length > 0) return occ;
  }
  return null;
}

/** Address for sorting (undefined → empty string sorts first). */
function sortAddr(row: Row): string {
  return row.order.address ?? "";
}

/** Sort by address string (similar addresses cluster). */
export function sortByAddress(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => sortAddr(a).localeCompare(sortAddr(b)));
}

/** All rows for an occasion (any status — draft/confirmed/canceled all shown, rendered differently). */
export function byOccasion(rows: Row[], occasion: Occasion): Row[] {
  return rows.filter((r) => r.order.occasion === occasion);
}

/** Preview: current meal + non-canceled + pending + address prefix match. Does NOT mutate. */
export function previewAddressMatch(rows: Row[], occasion: Occasion, fragment: string): Row[] {
  return byOccasion(rows, occasion).filter((r) => {
    const d = lifecycleDots(r);
    return d.base !== "canceled" && d.delivery === "pending" && addressMatches(r.order.address ?? "", fragment);
  });
}

/** Gap: non-canceled + pending delivery count for this occasion. */
export function gapCount(rows: Row[], occasion: Occasion): number {
  return byOccasion(rows, occasion).filter((r) => {
    const d = lifecycleDots(r);
    return d.base !== "canceled" && d.delivery === "pending";
  }).length;
}
