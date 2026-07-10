import type { Order, OrderSummary } from "@cfp/kith-inn-v1-shared";

export function confirmedOrdersForChecklist(orders: Order[]): Order[] {
  return orders.filter((order) => order.status === "confirmed")
    .sort((left, right) => left.address.localeCompare(right.address) ||
      left.displayName.localeCompare(right.displayName, "zh-CN") ||
      String(left.id).localeCompare(String(right.id)));
}

export function summarizeOrders(orders: Order[]): OrderSummary {
  return confirmedOrdersForChecklist(orders).reduce<OrderSummary>((summary, order) => {
    summary.confirmedOrders += 1;
    summary.totalQuantity += order.quantity;
    if (order.paymentStatus === "unpaid") summary.unpaid += 1;
    if (order.deliveryStatus === "pending") summary.pendingDelivery += 1;
    return summary;
  }, { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 });
}
