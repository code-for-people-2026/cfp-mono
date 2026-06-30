import type { Order } from "@cfp/kith-inn-shared";

type DotTone = "green" | "red" | "amber" | "muted";
type StatusDot = { label: string; tone: DotTone };

/**
 * Status dot for an order card (prototype 收/欠/草/废):
 * canceled → 废(muted); draft → 草(amber); confirmed+paid → 收(green); confirmed+unpaid → 欠(red).
 */
export function orderStatusDot(order: Order): StatusDot {
  if (order.status === "canceled") return { label: "废", tone: "muted" };
  if (order.status === "draft") return { label: "草", tone: "amber" };
  // Only `unpaid` owes — paid AND reconciled are collected (Codex).
  return order.paymentStatus === "unpaid" ? { label: "欠", tone: "red" } : { label: "收", tone: "green" };
}

/** Customer display name — `order.customer` is populated to a Customer at cms depth 1. */
export function customerName(order: Order): string {
  const c = order.customer;
  return typeof c === "object" && c !== null ? c.displayName : `#${c}`;
}

/** totalCents → "¥N" (null/undefined → "—"). */
export function yuan(totalCents?: number): string {
  return totalCents == null ? "—" : `¥${Math.round(totalCents / 100)}`;
}
