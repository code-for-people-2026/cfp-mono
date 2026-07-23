import type { MealSlot, Order, OrderSummary } from "@cfp/kith-inn-v1-shared";

export type MerchantMealState =
  | "unplanned"
  | "menu-ready"
  | "booking-open"
  | "deadline-passed"
  | "closed";

const STATE_TEXT: Record<MerchantMealState, string> = {
  unplanned: "尚未排菜单",
  "menu-ready": "已排菜单但未开放",
  "booking-open": "预订中",
  "deadline-passed": "已截止",
  closed: "已关闭"
};

const EMPTY_SUMMARY: OrderSummary = {
  confirmedOrders: 0,
  totalQuantity: 0,
  unpaid: 0,
  pendingDelivery: 0
};

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export type MerchantMealCard = {
  occasion: MealSlot["occasion"];
  slot: MealSlot | null;
  state: MerchantMealState;
  stateText: string;
  priceText: string | null;
  canManualAdd: boolean;
  waitingConfirmation: number;
  confirmedOrders: number;
  confirmedQuantity: number;
  unpaid: number;
  pendingDelivery: number;
};

export function businessDateInShanghai(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function retainMealsForRefresh<T>(currentDate: string, nextDate: string, meals: T[]): T[] {
  return currentDate === nextDate ? meals : [];
}

export function merchantMealState(slot: MealSlot | null, now: Date): MerchantMealState {
  if (slot === null) return "unplanned";
  if (slot.orderStatus === "draft") return "menu-ready";
  if (slot.orderStatus === "closed") return "closed";
  if (slot.orderDeadline === null) return "menu-ready";
  if (Date.parse(slot.orderDeadline) <= now.getTime()) {
    return "deadline-passed";
  }
  return "booking-open";
}

export function merchantPriceText(priceCents: number | null): string {
  return priceCents === null ? "商家默认价" : `¥${(priceCents / 100).toFixed(2)}`;
}

export function buildMerchantMealCard(input: {
  occasion: MealSlot["occasion"];
  slot: MealSlot | null;
  orders: Order[];
  summary: OrderSummary;
  now: Date;
}): MerchantMealCard {
  const state = merchantMealState(input.slot, input.now);
  const summary = input.slot === null ? EMPTY_SUMMARY : input.summary;
  return {
    occasion: input.occasion,
    slot: input.slot,
    state,
    stateText: STATE_TEXT[state],
    priceText: input.slot === null ? null : merchantPriceText(input.slot.priceCents),
    canManualAdd: input.slot !== null,
    waitingConfirmation: input.slot === null
      ? 0
      : input.orders.filter((order) => order.status === "draft").length,
    confirmedOrders: summary.confirmedOrders,
    confirmedQuantity: summary.totalQuantity,
    unpaid: summary.unpaid,
    pendingDelivery: summary.pendingDelivery
  };
}
