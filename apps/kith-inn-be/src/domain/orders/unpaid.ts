import type { Order } from "@cfp/kith-inn-shared";

/**
 * 到账记录汇总（PRD §6.5 MVP = 纯手动标）。未标到账：**已确认** 且 `paymentStatus=unpaid`
 * 的订单（跨日）。draft（默认就是 unpaid，但尚未成单）与 canceled（已作废、§7.1 不计入）
 * 排除——它们不是真实欠款。纯函数。催收提醒属 M2。
 */
export function unpaidSummary(orders: Order[]): { count: number; totalCents: number; orders: Order[] } {
  const unpaid = orders.filter((o) => o.status === "confirmed" && o.paymentStatus === "unpaid");
  return {
    count: unpaid.length,
    totalCents: unpaid.reduce((sum, o) => sum + (o.totalCents ?? 0), 0),
    orders: unpaid,
  };
}
