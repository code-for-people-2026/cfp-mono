import { describe, expect, it } from "vitest";
import type { CmsCustomerProfile, MealSlot, Order, SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import {
  buildDraftOrder,
  draftOrderPatch,
  existingOrderSummary,
  OrderDraftOnlyError,
  publicCustomerProfile
} from "./service";

const seller: SellerSnapshot = {
  id: 7,
  name: "桃子",
  defaultPriceCents: 3000,
  status: "active"
};
const profile: CmsCustomerProfile = {
  id: 21,
  sellerId: 7,
  openid: "customer-openid",
  displayName: "王阿姨",
  address: "3A-1201",
  active: true
};
const slot: MealSlot = {
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems: [
    { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
    { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
    { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
    { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
    { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
  ],
  orderStatus: "draft",
  priceCents: null,
  generatedAt: "2026-07-10T01:00:00.000Z"
};
const order: Order = {
  id: 31,
  sellerId: 7,
  mealSlotId: 11,
  customerProfileId: 21,
  status: "draft",
  source: "manual",
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 3000,
  totalCents: 6000,
  paymentStatus: "unpaid",
  paidAt: null,
  deliveryStatus: "pending",
  deliveredAt: null,
  confirmedAt: null,
  canceledAt: null,
  note: null
};

describe("manual draft order service", () => {
  it("builds snapshots and falls back to the seller default price", () => {
    expect(buildDraftOrder({ seller, slot, profile, quantity: 2, note: "少辣" })).toEqual({
      mealSlotId: 11,
      customerProfileId: 21,
      customerOpenid: "customer-openid",
      status: "draft",
      source: "manual",
      displayName: "王阿姨",
      address: "3A-1201",
      quantity: 2,
      unitPriceCents: 3000,
      paymentStatus: "unpaid",
      paidAt: null,
      deliveryStatus: "pending",
      deliveredAt: null,
      confirmedAt: null,
      canceledAt: null,
      note: "少辣"
    });
  });

  it("prefers the meal-slot price and preserves a missing customer openid", () => {
    expect(buildDraftOrder({
      seller,
      slot: { ...slot, priceCents: 2500 },
      profile: { ...profile, openid: null },
      quantity: 1,
      note: null
    })).toMatchObject({ unitPriceCents: 2500, customerOpenid: null, note: null });
  });

  it("creates draft-only patches and rejects non-draft edits", () => {
    expect(draftOrderPatch(order, {
      quantity: 3,
      displayName: "王姨",
      address: "3A-1202",
      note: "门口放"
    })).toEqual({ quantity: 3, displayName: "王姨", address: "3A-1202", note: "门口放" });
    expect(draftOrderPatch(order, { note: null })).toEqual({ note: null });
    expect(() => draftOrderPatch({ ...order, status: "confirmed" }, { quantity: 3 }))
      .toThrow(OrderDraftOnlyError);
    expect(() => draftOrderPatch({ ...order, status: "canceled" }, { quantity: 3 }))
      .toThrow(OrderDraftOnlyError);
  });

  it("exposes no openid and returns only the duplicate summary", () => {
    expect(publicCustomerProfile(profile)).toEqual({
      id: 21,
      sellerId: 7,
      displayName: "王阿姨",
      address: "3A-1201",
      active: true
    });
    expect(existingOrderSummary(order)).toEqual({ id: 31, status: "draft", quantity: 2 });
  });
});
