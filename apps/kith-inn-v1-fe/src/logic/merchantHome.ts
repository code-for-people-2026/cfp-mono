import type { MealSlot, Order, OrderSummary } from "@cfp/kith-inn-v1-shared";

export type MerchantMealState =
  | "unplanned"
  | "menu-ready"
  | "booking-open"
  | "deadline-passed"
  | "closed";

const STATE_TEXT: Record<MerchantMealState, string> = {
  unplanned: "未排菜单",
  "menu-ready": "待开放",
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

export function merchantGreeting(now: Date): string {
  const hour = new Date(now.getTime() + SHANGHAI_OFFSET_MS).getUTCHours();
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
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
  if (priceCents === null) return "商家默认价";
  const price = priceCents / 100;
  return `¥${Number.isInteger(price) ? String(price) : price.toFixed(2)} / 份`;
}

export function merchantDeadlineText(value: string | null): string {
  const timestamp = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(timestamp)
    ? "未设置截止时间"
    : `${new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(11, 16)} 截止`;
}

export function merchantMenuSummary(items: MealSlot["menuItems"]): string {
  if (items.length === 0) return "菜单已排好";
  const names = items.slice(0, 3).map((item) => item.nameSnapshot).join(" · ");
  if (items.length <= 3) return names;
  const soups = items.filter((item) => item.categorySnapshot === "soup").length;
  const dishes = items.length - soups;
  return `${names}等 ${dishes > 0 ? `${dishes}菜` : ""}${soups > 0 ? `${soups}汤` : ""}`;
}

export function merchantMenuText(slot: MealSlot | null, state: MerchantMealState): string {
  if (slot === null) return "今天还没有安排这个餐次";
  if (state !== "menu-ready") return merchantMenuSummary(slot.menuItems);
  if (slot.priceCents === null && slot.orderDeadline === null) return "菜单已排好，价格与截止时间还未确认";
  if (slot.priceCents === null) return "菜单已排好，价格还未确认";
  if (slot.orderDeadline === null) return "菜单已排好，截止时间还未确认";
  return merchantMenuSummary(slot.menuItems);
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
