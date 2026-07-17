import type {
  BulkMarkDeliveredResult,
  ManualOrderCreate,
  ManualOrderUpdate,
  MealSlot,
  Order,
  OrderAction,
  OrderResubmit,
  OrderSummary
} from "@cfp/kith-inn-v1-shared";
import { ApiError } from "../services/api";

type ManualOrderForm = {
  mealSlotId: string | number;
  customerProfileId: string | number | null;
  displayName: string;
  address: string;
  quantity: string;
  note: string;
};

const positiveInteger = (value: string) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

export function buildManualOrderCreate(form: ManualOrderForm): ManualOrderCreate | null {
  const quantity = positiveInteger(form.quantity);
  if (quantity === null) return null;
  const note = form.note.trim() || null;
  if (form.customerProfileId !== null) {
    return { mealSlotId: form.mealSlotId, customerProfileId: form.customerProfileId, quantity, note };
  }
  const displayName = form.displayName.trim();
  const address = form.address.trim();
  return displayName && address
    ? { mealSlotId: form.mealSlotId, newProfile: { displayName, address }, quantity, note }
    : null;
}

export function buildOrderEdit(form: {
  quantity: string;
  displayName: string;
  address: string;
  note: string;
}, confirmedImpactAccepted = false): ManualOrderUpdate | null {
  const quantity = positiveInteger(form.quantity);
  const displayName = form.displayName.trim();
  const address = form.address.trim();
  return quantity !== null && displayName && address
    ? {
      quantity,
      displayName,
      address,
      note: form.note.trim() || null,
      ...(confirmedImpactAccepted ? { confirmedImpactAccepted: true as const } : {})
    }
    : null;
}

export function availableOrderActions(order: Order): OrderAction[] {
  if (order.status === "draft") return ["confirm", "cancel"];
  if (order.status === "canceled") return ["resubmit"];
  return [
    "cancel",
    order.paymentStatus === "paid" ? "mark-unpaid" : "mark-paid",
    order.deliveryStatus === "done" ? "mark-pending-delivery" : "mark-delivered"
  ];
}

export function orderResubmitInput(order: Order): OrderResubmit {
  if (order.address === null) throw new Error("接龙导入订单没有地址，不能沿用手工重提");
  return {
    quantity: order.quantity,
    displayName: order.displayName,
    address: order.address,
    note: order.note
  };
}

export function orderAddressText(order: Pick<Order, "address">): string {
  return order.address ?? "无地址";
}

export function orderStateText(order: Order): string {
  const business = { draft: "草稿", confirmed: "已确认", canceled: "已取消" }[order.status];
  const payment = order.paymentStatus === "paid" ? "已付" : "未付";
  const delivery = order.deliveryStatus === "done" ? "已送" : "待送";
  return `业务：${business}；付款：${payment}；配送：${delivery}`;
}

export function duplicateDraftUpdate(error: unknown, input: ManualOrderCreate): {
  id: string | number;
  patch: ManualOrderUpdate;
} | null {
  if (!(error instanceof ApiError) || error.code !== "order-exists" ||
    typeof error.data !== "object" || error.data === null || !("existing" in error.data)) return null;
  const existing = (error.data as { existing?: unknown }).existing;
  if (typeof existing !== "object" || existing === null) return null;
  const value = existing as { id?: unknown; status?: unknown };
  const validId = (typeof value.id === "string" && value.id !== "") ||
    (typeof value.id === "number" && Number.isInteger(value.id));
  return validId && value.status === "draft"
    ? { id: value.id as string | number, patch: { quantity: input.quantity, note: input.note } }
    : null;
}

export function orderSummaryText(summary: OrderSummary): string {
  return `已确认 ${summary.confirmedOrders} 单，共 ${summary.totalQuantity} 份；未付 ${summary.unpaid} 单，待送 ${summary.pendingDelivery} 单`;
}

export function replaceOrder(orders: Order[], replacement: Order): Order[] {
  return [...orders.filter((order) => String(order.id) !== String(replacement.id)), replacement]
    .sort((left, right) => orderAddressText(left).localeCompare(orderAddressText(right)) ||
      left.displayName.localeCompare(right.displayName, "zh-CN") || String(left.id).localeCompare(String(right.id)));
}

const sameOrderId = (left: string | number, right: string | number) => String(left) === String(right);

export function toggleBulkOrderSelection(selected: Array<string | number>, order: Order): Array<string | number> {
  if (order.status !== "confirmed") return selected;
  return selected.some((id) => sameOrderId(id, order.id))
    ? selected.filter((id) => !sameOrderId(id, order.id))
    : [...selected, order.id];
}

export function bulkDeliveryFeedback(results: BulkMarkDeliveredResult[]): string[] {
  return results.map((result) => result.status === "updated"
    ? `订单 ${result.id}：已送`
    : `订单 ${result.id}：失败（${result.error}）`);
}

function confirmedChecklistOrders(orders: Order[]): Order[] {
  return orders.filter((order) => order.status === "confirmed")
    .sort((left, right) => orderAddressText(left).localeCompare(orderAddressText(right)) ||
      left.displayName.localeCompare(right.displayName, "zh-CN") ||
      String(left.id).localeCompare(String(right.id)));
}

export function orderChecklistText(mealSlot: MealSlot, orders: Order[]): string {
  const confirmed = confirmedChecklistOrders(orders);
  const occasion = mealSlot.occasion === "lunch" ? "午餐" : "晚餐";
  return [
    `餐次：${mealSlot.date} ${occasion}`,
    `总份数：${confirmed.reduce((total, order) => total + order.quantity, 0)}`,
    ...confirmed.map((order) => `${orderAddressText(order)}｜${order.displayName}｜${order.quantity} 份`)
  ].join("\n");
}

export function copyOrderChecklist(
  mealSlot: MealSlot,
  orders: Order[],
  setClipboardData: (options: { data: string }) => Promise<unknown>
): Promise<unknown> {
  return setClipboardData({ data: orderChecklistText(mealSlot, orders) });
}
