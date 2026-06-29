import type { Order } from "@cfp/kith-inn-shared";

/**
 * 收款汇总（PRD §6.5 MVP = 纯手动标）。谁没付款：`paymentStatus=unpaid` 的订单（跨日）。
 * 纯函数。催收提醒属 M2。
 */
export function unpaidSummary(orders: Order[]): { count: number; totalCents: number; orders: Order[] } {
  const unpaid = orders.filter((o) => o.paymentStatus === "unpaid");
  return {
    count: unpaid.length,
    totalCents: unpaid.reduce((sum, o) => sum + (o.totalCents ?? 0), 0),
    orders: unpaid,
  };
}
