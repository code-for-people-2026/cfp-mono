import { describe, expect, it, vi } from "vitest";
import type { MealSlot, Order, OrderSummary } from "@cfp/kith-inn-v1-shared";
import {
  buildMerchantMealCard,
  businessDateInShanghai,
  merchantDeadlineText,
  merchantGreeting,
  merchantMenuSummary,
  merchantMenuText,
  merchantMealState,
  merchantPriceText,
  retainMealsForRefresh
} from "./merchantHome";

const menuItems: MealSlot["menuItems"] = [
  { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
  { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
  { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
  { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
  { offeringId: 5, nameSnapshot: "汤", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
];

const slot = (overrides: Partial<MealSlot> = {}): MealSlot => ({
  id: 11,
  sellerId: 7,
  date: "2026-07-24",
  occasion: "lunch",
  menuItems,
  orderStatus: "open",
  orderDeadline: "2026-07-24T04:00:00.000Z",
  priceCents: 2800,
  generatedAt: "2026-07-23T01:00:00.000Z",
  ...overrides
});

const order = (overrides: Partial<Order> = {}): Order => ({
  id: 31,
  sellerId: 7,
  mealSlotId: 11,
  customerProfileId: 21,
  status: "draft",
  source: "manual",
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 2800,
  totalCents: 5600,
  paymentStatus: "unpaid",
  paidAt: null,
  deliveryStatus: "pending",
  deliveredAt: null,
  confirmedAt: null,
  canceledAt: null,
  note: null,
  ...overrides
});

const summary: OrderSummary = {
  confirmedOrders: 2,
  totalQuantity: 5,
  unpaid: 1,
  pendingDelivery: 2
};

describe("merchant home state model", () => {
  it("derives the business date across the Asia/Shanghai UTC boundary", () => {
    expect(businessDateInShanghai(new Date("2026-07-23T15:59:59.999Z"))).toBe("2026-07-23");
    expect(businessDateInShanghai(new Date("2026-07-23T16:00:00.000Z"))).toBe("2026-07-24");
  });

  it("does not depend on Intl locale or timezone data", () => {
    const formatter = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl unavailable");
    });
    try {
      expect(businessDateInShanghai(new Date("2026-07-23T16:00:00.000Z"))).toBe("2026-07-24");
    } finally {
      formatter.mockRestore();
    }
  });

  it("keeps visible cards only while refreshing the same business date", () => {
    const meals = [{ occasion: "lunch" }];
    expect(retainMealsForRefresh("2026-07-24", "2026-07-24", meals)).toBe(meals);
    expect(retainMealsForRefresh("2026-07-24", "2026-07-25", meals)).toEqual([]);
  });

  it("derives all five slot states and treats the exact deadline as passed", () => {
    const now = new Date("2026-07-24T04:00:00.000Z");
    expect(merchantMealState(null, now)).toBe("unplanned");
    expect(merchantMealState(slot({ orderStatus: "draft", orderDeadline: null }), now)).toBe("menu-ready");
    expect(merchantMealState(slot({ orderDeadline: "2026-07-24T04:00:00.001Z" }), now)).toBe("booking-open");
    expect(merchantMealState(slot({ orderDeadline: null }), now)).toBe("menu-ready");
    expect(merchantMealState(slot({ orderDeadline: now.toISOString() }), now)).toBe("deadline-passed");
    expect(merchantMealState(slot({ orderDeadline: "2026-07-24T03:59:59.999Z" }), now))
      .toBe("deadline-passed");
    expect(merchantMealState(slot({ orderStatus: "closed" }), now)).toBe("closed");
  });

  it("formats configured and default prices without inventing an amount", () => {
    expect(merchantPriceText(2800)).toBe("¥28 / 份");
    expect(merchantPriceText(2850)).toBe("¥28.50 / 份");
    expect(merchantPriceText(0)).toBe("¥0 / 份");
    expect(merchantPriceText(null)).toBe("商家默认价");
  });

  it("builds natural Shanghai greetings at each day-part boundary", () => {
    expect(merchantGreeting(new Date("2026-07-23T23:00:00.000Z"))).toBe("早上好");
    expect(merchantGreeting(new Date("2026-07-24T03:00:00.000Z"))).toBe("中午好");
    expect(merchantGreeting(new Date("2026-07-24T06:00:00.000Z"))).toBe("下午好");
    expect(merchantGreeting(new Date("2026-07-24T10:00:00.000Z"))).toBe("晚上好");
  });

  it("summarizes real menu names and category counts without placeholder dishes", () => {
    expect(merchantMenuSummary(menuItems)).toBe("荤一 · 荤二 · 素一等 4菜1汤");
    expect(merchantMenuSummary(menuItems.slice(0, 3))).toBe("荤一 · 荤二 · 素一");
    expect(merchantMenuSummary(menuItems.slice(0, 4))).toBe("荤一 · 荤二 · 素一等 4菜");
    expect(merchantMenuSummary(menuItems.map((item) => ({ ...item, categorySnapshot: "soup" })))).toBe(
      "荤一 · 荤二 · 素一等 5汤"
    );
    expect(merchantMenuSummary([])).toBe("菜单已排好");
  });

  it("explains only the settings missing from a menu-ready slot", () => {
    expect(merchantMenuText(null, "unplanned")).toBe("今天还没有安排这个餐次");
    expect(merchantMenuText(slot({ priceCents: null, orderDeadline: null }), "menu-ready"))
      .toBe("菜单已排好，价格与截止时间还未确认\n荤一 · 荤二 · 素一等 4菜1汤");
    expect(merchantMenuText(slot({ priceCents: null }), "menu-ready"))
      .toBe("菜单已排好，价格还未确认\n荤一 · 荤二 · 素一等 4菜1汤");
    expect(merchantMenuText(slot({ orderDeadline: null }), "menu-ready"))
      .toBe("菜单已排好，截止时间还未确认\n荤一 · 荤二 · 素一等 4菜1汤");
    expect(merchantMenuText(slot({ menuItems: [], priceCents: null, orderDeadline: null }), "menu-ready"))
      .toBe("菜单已排好，价格与截止时间还未确认");
    expect(merchantMenuText(slot(), "menu-ready")).toBe("荤一 · 荤二 · 素一等 4菜1汤");
    expect(merchantMenuText(slot(), "booking-open")).toBe("荤一 · 荤二 · 素一等 4菜1汤");
  });

  it("formats Shanghai deadlines and keeps missing or invalid values explicit", () => {
    expect(merchantDeadlineText("2026-07-24T02:30:00.000Z")).toBe("10:30 截止");
    expect(merchantDeadlineText(null)).toBe("未设置截止时间");
    expect(merchantDeadlineText("invalid")).toBe("未设置截止时间");
  });

  it("builds an unplanned card with no order metrics or manual-add eligibility", () => {
    expect(buildMerchantMealCard({
      occasion: "dinner",
      slot: null,
      orders: [order()],
      summary,
      now: new Date("2026-07-24T04:00:00.000Z")
    })).toEqual({
      occasion: "dinner",
      slot: null,
      state: "unplanned",
      stateText: "未排菜单",
      priceText: null,
      canManualAdd: false,
      waitingConfirmation: 0,
      confirmedOrders: 0,
      confirmedQuantity: 0,
      unpaid: 0,
      pendingDelivery: 0
    });
  });

  it("keeps confirmed summaries separate from draft waiting-confirmation counts", () => {
    const mealSlot = slot({ priceCents: null });
    const card = buildMerchantMealCard({
      occasion: "lunch",
      slot: mealSlot,
      orders: [
        order({ id: 31 }),
        order({ id: 32 }),
        order({ id: 33, status: "confirmed", confirmedAt: "2026-07-23T02:00:00.000Z" }),
        order({ id: 34, status: "canceled", canceledAt: "2026-07-23T03:00:00.000Z" })
      ],
      summary,
      now: new Date("2026-07-24T03:00:00.000Z")
    });

    expect(card).toEqual({
      occasion: "lunch",
      slot: mealSlot,
      state: "booking-open",
      stateText: "预订中",
      priceText: "商家默认价",
      canManualAdd: true,
      waitingConfirmation: 2,
      confirmedOrders: 2,
      confirmedQuantity: 5,
      unpaid: 1,
      pendingDelivery: 2
    });
  });

  it("labels every existing slot state while keeping manual add available", () => {
    const now = new Date("2026-07-24T04:00:00.000Z");
    const cases: Array<[MealSlot, string]> = [
      [slot({ orderStatus: "draft", orderDeadline: null }), "待开放"],
      [slot({ orderDeadline: "2026-07-24T05:00:00.000Z" }), "预订中"],
      [slot({ orderDeadline: now.toISOString() }), "已截止"],
      [slot({ orderStatus: "closed" }), "已关闭"]
    ];

    for (const [mealSlot, stateText] of cases) {
      expect(buildMerchantMealCard({
        occasion: mealSlot.occasion,
        slot: mealSlot,
        orders: [],
        summary: { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 },
        now
      })).toMatchObject({ stateText, canManualAdd: true });
    }
  });
});
