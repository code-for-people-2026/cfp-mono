import { describe, expect, it } from "vitest";
import {
  addressGapSchema,
  addressGroupSchema,
  cardPayloadSchema,
  chatMessageSchema,
  confirmCustomerItemSchema,
  customerSchema,
  deliveryCardDataSchema,
  deliveryCardGroupSchema,
  deliveryViewSchema,
  fulfillmentSchema,
  menuDishSchema,
  menuPlanSchema,
  menuSlotSchema,
  offeringSchema,
  operatorSchema,
  orderCardDataSchema,
  orderItemSchema,
  orderSchema,
  serviceSlotSchema,
  sellerSchema,
  weekMenuSchema,
} from "./schemas";

const id = 1 as const;

describe("domain schemas — happy parse", () => {
  it("seller / operator / customer", () => {
    const seller = { id, name: "桃子", status: "active" };
    expect(sellerSchema.parse(seller)).toEqual(seller);
    expect(operatorSchema.parse({ id, wechatOpenid: "op", role: "owner", active: true, seller: id })).toMatchObject({ role: "owner" });
    expect(customerSchema.parse({ id, displayName: "王燕萍", seller: id })).toMatchObject({ displayName: "王燕萍" });
  });

  it("offering (self-ref parentOfferings accepts id or populated)", () => {
    const component = { id, name: "番茄炒蛋", kind: "component" as const, category: "veg" as const, seller: id };
    expect(offeringSchema.parse(component)).toEqual(component);
    const parsed = offeringSchema.parse({ id: 2, name: "套餐", kind: "combo-meal", parentOfferings: [component, 3], seller: id });
    expect(parsed.parentOfferings).toEqual([component, 3]);
  });

  it("serviceSlot / orderItem / order / fulfillment / menuPlan / chatMessage", () => {
    expect(serviceSlotSchema.parse({ id, date: "2026-07-02", granularity: "occasion", occasion: "lunch", status: "open", seller: id })).toMatchObject({ status: "open" });
    expect(orderItemSchema.parse({ id, order: 5, offering: 10, quantity: 2, seller: id })).toMatchObject({ quantity: 2 });
    expect(orderSchema.parse({ id, customer: 7, date: "2026-07-02", occasion: "lunch", status: "draft", source: "chat-paste", paymentStatus: "unpaid", seller: id })).toMatchObject({ status: "draft" });
    expect(fulfillmentSchema.parse({ id, order: 20, serviceDate: "2026-07-02", occasion: "lunch", status: "pending", seller: id })).toMatchObject({ status: "pending" });
    expect(menuPlanSchema.parse({ id, slot: 1, offerings: [10, { id: 20, name: "番茄炒蛋", kind: "component", category: "veg", seller: id }], status: "draft", seller: id })).toMatchObject({ status: "draft" });
    expect(chatMessageSchema.parse({ id, content: "hi", role: "user", createdAt: "t", seller: id })).toMatchObject({ role: "user" });
  });
});

describe("contract schemas", () => {
  const dish = { id, name: "红烧牛肉", category: "meat" as const, mainIngredient: "牛肉", tags: ["费工"], useCount: 3, lastUsedAt: "t" };

  it("menu / address / deliveryView", () => {
    expect(menuDishSchema.parse(dish)).toEqual(dish);
    const slot = { day: "mon", occasion: "lunch" as const, dishes: [dish] };
    expect(menuSlotSchema.parse(slot)).toMatchObject({ occasion: "lunch" });
    expect(weekMenuSchema.parse({ ok: true, menu: [slot] })).toMatchObject({ ok: true });
    expect(weekMenuSchema.parse({ ok: false, reason: "pool-too-small", missing: { category: "soup", needed: 1, available: 0, slot: "mon-lunch" } })).toMatchObject({ reason: "pool-too-small" });
    expect(addressGroupSchema.parse({ address: "3A", count: 2, fulfillments: [] })).toMatchObject({ address: "3A" });
    expect(addressGapSchema.parse({ address: "3A", pending: 2 })).toEqual({ address: "3A", pending: 2 });
    expect(deliveryViewSchema.parse({ sort: [], gaps: { gaps: [], totalPending: 0 } })).toMatchObject({ gaps: { totalPending: 0 } });
  });

  it("cards", () => {
    expect(confirmCustomerItemSchema.parse({ customerName: "大龙猫", address: "26B", quantity: 1, occasion: "dinner", date: "2026-07-02" })).toMatchObject({ occasion: "dinner" });
    const order = { id, customer: 7, date: "2026-07-02", occasion: "lunch" as const, status: "draft" as const, source: "chat-paste", paymentStatus: "unpaid", seller: id };
    expect(orderCardDataSchema.parse({ orders: [order], date: "2026-07-02" })).toMatchObject({ orders: [order] });
    expect(deliveryCardGroupSchema.parse({ address: "3A", count: 2, done: 1, total: 2, ids: [201, 202] })).toMatchObject({ total: 2 });
    expect(deliveryCardDataSchema.parse({ totalPending: 1, groups: [] })).toMatchObject({ totalPending: 1 });
    expect(cardPayloadSchema.parse({ type: "customer-confirm", data: { items: [{ customerName: "X", quantity: 1, occasion: "lunch" }] } })).toMatchObject({ type: "customer-confirm" });
    expect(cardPayloadSchema.parse({ type: "orders", data: { orders: [], date: "2026-07-02" } })).toMatchObject({ type: "orders" });
    expect(cardPayloadSchema.parse({ type: "delivery", data: { totalPending: 0, groups: [] } })).toMatchObject({ type: "delivery" });
  });
});

describe("rejections", () => {
  it("rejects unknown enum values", () => {
    expect(() => orderSchema.parse({ id, customer: 7, date: "x", status: "nope", source: "chat-paste", paymentStatus: "unpaid", seller: id })).toThrow();
    expect(() => orderSchema.parse({ id, customer: 7, date: "x", occasion: "tea", status: "draft", source: "chat-paste", paymentStatus: "unpaid", seller: id })).toThrow();
    expect(() => confirmCustomerItemSchema.parse({ customerName: "X", quantity: 1, occasion: "breakfast" })).toThrow(); // occasion not in MEAL_OCCASIONS
    expect(() => cardPayloadSchema.parse({ type: "unknown", data: {} })).toThrow(); // bad discriminant
  });

  it("rejects missing required fields", () => {
    expect(() => orderSchema.parse({ id, date: "x", status: "draft", source: "chat-paste", paymentStatus: "unpaid", seller: id })).toThrow(); // missing customer
    expect(() => weekMenuSchema.parse({ ok: true })).toThrow(); // missing menu
    expect(() => fulfillmentSchema.parse({ id, serviceDate: "x", seller: id })).toThrow(); // missing status + order
  });
});
