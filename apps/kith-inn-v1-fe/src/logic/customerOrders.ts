import type { CustomerBookingBatchView, CustomerOrderView } from "@cfp/kith-inn-v1-shared";

export function customerOrderLabels(order: CustomerOrderView): [string, string, string] {
  const business = { draft: "待桃子确认", confirmed: "桃子已确认", canceled: "已取消" }[order.status];
  return [business, order.paymentStatus === "paid" ? "已付款" : "未付款",
    order.deliveryStatus === "done" ? "已送达" : "待送达"];
}

export function customerOrderLockText(order: CustomerOrderView, batch: CustomerBookingBatchView | null): string | null {
  if (order.status === "confirmed") return "桃子已确认，请在群里联系桃子";
  if (order.status === "canceled") return "订单已取消";
  if (!batch) return "如需修改，请从预订卡片进入";
  const slot = batch.slots.find(({ date, occasion }) => date === order.target.date && occasion === order.target.occasion);
  if (!slot) return "如需修改，请从预订卡片进入";
  return batch.status === "open" && slot.canBook && order.orderStatus === "open"
    ? null : "本餐次已截止，请在群里联系桃子";
}

export function customerOrderQuantity(value: string): number | null {
  const quantity = Number(value.trim());
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

export function customerWriteErrorText(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code : null;
  if (code === "confirmed-order-locked") return "桃子已确认，请在群里联系桃子";
  if (["booking-batch-closed", "meal-slot-not-in-batch", "meal-slot-closed", "order-deadline-passed"]
    .includes(String(code))) return "本餐次已截止，请在群里联系桃子";
  return "操作失败，请刷新后重试";
}
