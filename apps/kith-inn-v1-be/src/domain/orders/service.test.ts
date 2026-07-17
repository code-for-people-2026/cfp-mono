import { describe, expect, it } from "vitest";
import type { CmsCustomerProfile, MealSlot, Order, SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import {
  buildDraftOrder,
  editOrderPatch,
  existingOrderSummary,
  ConfirmedImpactConfirmationRequiredError,
  InvalidOrderTransitionError,
  publicCustomerProfile,
  resubmitOrderPatch,
  transitionOrder
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
  orderDeadline: null,
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

  it("allows draft edits, confirms confirmed impact and rejects canceled edits", () => {
    expect(editOrderPatch(order, {
      quantity: 3,
      displayName: "王姨",
      address: "3A-1202",
      note: "门口放"
    })).toEqual({ quantity: 3, displayName: "王姨", address: "3A-1202", note: "门口放" });
    expect(editOrderPatch(order, { note: null })).toEqual({ note: null });
    expect(() => editOrderPatch({ ...order, status: "confirmed" }, { quantity: 3 }))
      .toThrow(ConfirmedImpactConfirmationRequiredError);
    expect(editOrderPatch(
      { ...order, status: "confirmed" },
      { quantity: 3, confirmedImpactAccepted: true }
    )).toEqual({ quantity: 3 });
    expect(() => editOrderPatch({ ...order, status: "canceled" }, { quantity: 3 }))
      .toThrow(InvalidOrderTransitionError);
  });

  it("preserves imported order snapshots while editing quantity and note", () => {
    const imported = {
      ...order,
      customerProfileId: null,
      source: "jielong-import" as const,
      address: null
    };
    expect(editOrderPatch(imported, {
      quantity: 3,
      displayName: "误改称呼",
      address: "误填地址",
      note: "门口放"
    })).toEqual({ quantity: 3, note: "门口放" });
  });

  it("transitions business status with idempotent target states", () => {
    const now = "2026-07-11T00:00:00.000Z";
    expect(transitionOrder(order, "confirm", now)).toEqual({
      status: "confirmed",
      confirmedAt: now,
      canceledAt: null
    });
    expect(transitionOrder({ ...order, status: "confirmed", confirmedAt: now }, "confirm", now)).toBeNull();
    expect(transitionOrder(order, "cancel", now)).toEqual({ status: "canceled", canceledAt: now });
    expect(transitionOrder({ ...order, status: "confirmed", confirmedAt: now }, "cancel", now))
      .toEqual({ status: "canceled", canceledAt: now });
    expect(transitionOrder({ ...order, status: "canceled", canceledAt: now }, "cancel", now)).toBeNull();
    expect(() => transitionOrder({ ...order, status: "canceled" }, "confirm", now))
      .toThrow(InvalidOrderTransitionError);
  });

  it("toggles payment and delivery only for confirmed orders", () => {
    const now = "2026-07-11T00:00:00.000Z";
    const confirmed = { ...order, status: "confirmed" as const, confirmedAt: now };
    expect(transitionOrder(confirmed, "mark-paid", now)).toEqual({ paymentStatus: "paid", paidAt: now });
    expect(transitionOrder({ ...confirmed, paymentStatus: "paid", paidAt: now }, "mark-paid", now)).toBeNull();
    expect(transitionOrder({ ...confirmed, paymentStatus: "paid", paidAt: now }, "mark-unpaid", now))
      .toEqual({ paymentStatus: "unpaid", paidAt: null });
    expect(transitionOrder(confirmed, "mark-unpaid", now)).toBeNull();
    expect(transitionOrder(confirmed, "mark-delivered", now)).toEqual({ deliveryStatus: "done", deliveredAt: now });
    expect(transitionOrder({ ...confirmed, deliveryStatus: "done", deliveredAt: now }, "mark-delivered", now)).toBeNull();
    expect(transitionOrder({ ...confirmed, deliveryStatus: "done", deliveredAt: now }, "mark-pending-delivery", now))
      .toEqual({ deliveryStatus: "pending", deliveredAt: null });
    expect(transitionOrder(confirmed, "mark-pending-delivery", now)).toBeNull();
    for (const status of ["draft", "canceled"] as const) {
      expect(() => transitionOrder({ ...order, status }, "mark-paid", now)).toThrow(InvalidOrderTransitionError);
      expect(() => transitionOrder({ ...order, status }, "mark-delivered", now)).toThrow(InvalidOrderTransitionError);
    }
  });

  it("applies the single-order delivery transition independently to bulk candidates", () => {
    const now = "2026-07-11T00:00:00.000Z";
    const confirmed = { ...order, status: "confirmed" as const, confirmedAt: now };
    expect(transitionOrder(confirmed, "mark-delivered", now))
      .toEqual({ deliveryStatus: "done", deliveredAt: now });
    expect(transitionOrder({ ...confirmed, deliveryStatus: "done", deliveredAt: now }, "mark-delivered", now))
      .toBeNull();
    expect(() => transitionOrder(order, "mark-delivered", now)).toThrow(InvalidOrderTransitionError);
  });

  it("resubmits canceled orders with fresh snapshots and cleared lifecycle fields", () => {
    const canceled = {
      ...order,
      status: "canceled" as const,
      paymentStatus: "paid" as const,
      paidAt: "2026-07-10T00:00:00.000Z",
      deliveryStatus: "done" as const,
      deliveredAt: "2026-07-10T00:01:00.000Z",
      confirmedAt: "2026-07-09T00:00:00.000Z",
      canceledAt: "2026-07-10T00:02:00.000Z"
    };
    expect(resubmitOrderPatch(canceled, {
      quantity: 4,
      displayName: "王姨",
      address: "3A-1202",
      note: "门口放"
    }, 2500)).toEqual({
      status: "draft",
      quantity: 4,
      displayName: "王姨",
      address: "3A-1202",
      note: "门口放",
      unitPriceCents: 2500,
      paymentStatus: "unpaid",
      paidAt: null,
      deliveryStatus: "pending",
      deliveredAt: null,
      confirmedAt: null,
      canceledAt: null
    });
    expect(() => resubmitOrderPatch(order, {
      quantity: 2,
      displayName: "王阿姨",
      address: "3A-1201",
      note: null
    }, 3000)).toThrow(InvalidOrderTransitionError);
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
