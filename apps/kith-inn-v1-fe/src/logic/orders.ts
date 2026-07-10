import type {
  ManualOrderCreate,
  ManualOrderUpdate,
  Order,
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

export function buildDraftEdit(form: {
  quantity: string;
  displayName: string;
  address: string;
  note: string;
}): ManualOrderUpdate | null {
  const quantity = positiveInteger(form.quantity);
  const displayName = form.displayName.trim();
  const address = form.address.trim();
  return quantity !== null && displayName && address
    ? { quantity, displayName, address, note: form.note.trim() || null }
    : null;
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
    .sort((left, right) => left.address.localeCompare(right.address) ||
      left.displayName.localeCompare(right.displayName, "zh-CN") || String(left.id).localeCompare(String(right.id)));
}
