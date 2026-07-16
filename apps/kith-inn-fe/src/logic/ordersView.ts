import type { Order } from "@cfp/kith-inn-shared";

export type DotTone = "green" | "red" | "amber" | "muted";
type StatusDot = { label: string; tone: DotTone };

/** Status-dot tone → atomic utility classes (shared by the orders tab + chat card). */
export const STATUS_DOT_CLASS: Record<DotTone, string> = {
  green: "bg-green-soft text-green",
  red: "bg-red-soft text-red",
  amber: "bg-amber-soft text-amber",
  muted: "bg-wash text-muted",
};

/**
 * Status dot for an order card (prototype 收/欠/草/废):
 * canceled → 废(muted); draft → 草(amber); confirmed+paid → 收(green); confirmed+unpaid → 欠(red).
 */
export function orderStatusDot(order: Order): StatusDot {
  if (order.status === "canceled") return { label: "废", tone: "muted" };
  if (order.status === "draft") return { label: "草", tone: "amber" };
  // 只有 `unpaid` 尚未标记到账；`paid` 与历史 `reconciled` 均按已标记到账展示。
  return order.paymentStatus === "unpaid" ? { label: "欠", tone: "red" } : { label: "收", tone: "green" };
}

/** Customer display name — FE-local because Taro doesn't transpile shared package .ts runtime exports. */
export function customerName(order: Order): string {
  const c = order.customer;
  return typeof c === "object" && c !== null ? c.displayName : `#${c}`;
}

/** totalCents → "¥N" (null/undefined → "—"). */
export function yuan(totalCents?: number): string {
  return totalCents == null ? "—" : `¥${Math.round(totalCents / 100)}`;
}
