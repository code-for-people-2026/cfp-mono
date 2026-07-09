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
  menuPlanViewSchema,
  menuSlotSchema,
  offeringCreateSchema,
  offeringSchema,
  offeringUpdateSchema,
  operatorSchema,
  orderCardDataSchema,
  orderItemSchema,
  orderSchema,
  serviceSlotSchema,
  sellerSchema,
  swapRequestSchema,
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

  it("chatMessage accepts assistant card snapshots but rejects user cards", () => {
    const card = { type: "operation-confirm" as const, data: { toolName: "mark_paid", summary: "将标记 #1 已付款", args: { orderId: 1 }, opId: "1" } };
    expect(chatMessageSchema.parse({ id, content: "待确认", role: "assistant", createdAt: "t", seller: id, card })).toMatchObject({ card });
    expect(() => chatMessageSchema.parse({ id, content: "接龙文本", role: "user", createdAt: "t", seller: id, card })).toThrow();
    expect(() => chatMessageSchema.parse({ id, content: "坏卡", role: "assistant", createdAt: "t", seller: id, card: { type: "unknown", data: {} } })).toThrow();
  });
});

describe("contract schemas", () => {
  const dish = { id, name: "红烧牛肉", category: "meat" as const, mainIngredient: "牛肉" };

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
    expect(cardPayloadSchema.parse({ type: "operation-confirm", data: { toolName: "mark_paid", summary: "x", args: { orderId: 1 }, opId: "1" } })).toMatchObject({ type: "operation-confirm" });
    expect(cardPayloadSchema.parse({ type: "orders", data: { orders: [], date: "2026-07-02" } })).toMatchObject({ type: "orders" });
    expect(cardPayloadSchema.parse({ type: "delivery", data: { totalPending: 0, groups: [] } })).toMatchObject({ type: "delivery" });
  });
});

describe("menu plan view + swap contract (feature 003)", () => {
  it("menuPlanViewSchema parses a draft plan with dishes", () => {
    const view = {
      planId: 501,
      date: "2026-07-08",
      occasion: "lunch",
      status: "draft",
      dishes: [{ id: 12, name: "红烧牛肉", category: "meat" }],
    };
    expect(menuPlanViewSchema.parse(view)).toEqual(view);
  });

  it("menuPlanViewSchema accepts published + publishText + strips extras", () => {
    const parsed = menuPlanViewSchema.parse({
      planId: 502,
      date: "2026-07-08",
      occasion: "dinner",
      status: "published",
      dishes: [],
      publishText: "【街坊味】…",
      slot: 91,
    } as Record<string, unknown>);
    expect(parsed.publishText).toBe("【街坊味】…");
    expect(parsed).not.toHaveProperty("slot");
  });

  it("menuPlanViewSchema rejects bad status / occasion", () => {
    expect(() => menuPlanViewSchema.parse({ planId: 1, date: "x", occasion: "lunch", status: "archived", dishes: [] })).toThrow();
    expect(() => menuPlanViewSchema.parse({ planId: 1, date: "x", occasion: "breakfast", status: "draft", dishes: [] })).toThrow();
  });

  it("swapRequestSchema requires dishId, optional replacementId/force, strips extras", () => {
    expect(swapRequestSchema.parse({ dishId: 12 })).toEqual({ dishId: 12 });
    expect(swapRequestSchema.parse({ dishId: 12, replacementId: 19, force: true })).toEqual({ dishId: 12, replacementId: 19, force: true });
    expect(() => swapRequestSchema.parse({ replacementId: 19 } as Record<string, unknown>)).toThrow();
    expect(swapRequestSchema.parse({ dishId: 12, junk: 9 } as Record<string, unknown>)).toEqual({ dishId: 12 });
  });
});

describe("offering write schemas (M1 菜品池 CRUD)", () => {
  it("offeringCreateSchema requires name + category, optional mainIngredient, strips extras", () => {
    expect(offeringCreateSchema.parse({ name: "红烧肉", mainIngredient: "猪肉", category: "meat" })).toEqual({
      name: "红烧肉",
      mainIngredient: "猪肉",
      category: "meat",
    });
    // mainIngredient optional
    expect(offeringCreateSchema.parse({ name: "神秘菜", category: "veg" })).toEqual({ name: "神秘菜", category: "veg" });
    // extras stripped (M1 whitelist)
    expect(offeringCreateSchema.parse({ name: "X", category: "soup", priceCents: 3000, kind: "combo-meal", seller: 7 } as Record<string, unknown>)).toEqual({ name: "X", category: "soup" });
  });

  it("offeringCreateSchema rejects missing name / category / bad category", () => {
    expect(() => offeringCreateSchema.parse({ category: "meat" } as Record<string, unknown>)).toThrow(); // missing name
    expect(() => offeringCreateSchema.parse({ name: "X" } as Record<string, unknown>)).toThrow(); // missing category
    expect(() => offeringCreateSchema.parse({ name: "", category: "meat" })).toThrow(); // empty name
    expect(() => offeringCreateSchema.parse({ name: "X", category: "seafood" })).toThrow(); // bad category
  });

  it("offeringUpdateSchema accepts any subset, strips extras", () => {
    expect(offeringUpdateSchema.parse({ name: "新名" })).toEqual({ name: "新名" });
    expect(offeringUpdateSchema.parse({ mainIngredient: "番茄" })).toEqual({ mainIngredient: "番茄" });
    expect(offeringUpdateSchema.parse({ category: "soup" })).toEqual({ category: "soup" });
    expect(offeringUpdateSchema.parse({ mainIngredient: null })).toEqual({ mainIngredient: null }); // explicit clear
    expect(offeringUpdateSchema.parse({ name: "X", category: "meat", priceCents: 99 } as Record<string, unknown>)).toEqual({ name: "X", category: "meat" });
  });

  it("offeringUpdateSchema rejects empty payload, bad category, empty name", () => {
    expect(() => offeringUpdateSchema.parse({})).toThrow(); // empty → refine
    expect(() => offeringUpdateSchema.parse({ priceCents: 99 } as Record<string, unknown>)).toThrow(); // strips to {} → refine
    expect(() => offeringUpdateSchema.parse({ category: "nope" })).toThrow(); // bad category
    expect(() => offeringUpdateSchema.parse({ name: "" })).toThrow(); // empty name
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
