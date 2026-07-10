import type { Order, OrderSummary } from "@cfp/kith-inn-v1-shared";

export function summarizeOrders(orders: Order[]): OrderSummary {
  return orders.reduce<OrderSummary>((summary, order) => {
    if (order.status !== "confirmed") return summary;
    summary.confirmedOrders += 1;
    summary.totalQuantity += order.quantity;
    if (order.paymentStatus === "unpaid") summary.unpaid += 1;
    if (order.deliveryStatus === "pending") summary.pendingDelivery += 1;
    return summary;
  }, { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 });
}
