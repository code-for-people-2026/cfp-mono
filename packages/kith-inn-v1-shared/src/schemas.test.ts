import { describe, expect, it } from "vitest";
import {
  bookingBatchInputSchema,
  bookingBatchStatusSchema,
  calendarDateSchema,
  customerProfileInputSchema,
  deliveryStatusSchema,
  mealSlotInputSchema,
  mealSlotOrderStatusSchema,
  occasionSchema,
  offeringCategorySchema,
  offeringInputSchema,
  operatorInputSchema,
  orderInputSchema,
  orderSourceSchema,
  orderStatusSchema,
  paymentStatusSchema,
  positiveIntegerSchema,
  sellerInputSchema,
  sellerStatusSchema,
  nonNegativeIntegerSchema
} from "./schemas";

describe("枚举 schemas", () => {
  const cases = [
    [sellerStatusSchema, ["active", "paused"]],
    [occasionSchema, ["lunch", "dinner"]],
    [offeringCategorySchema, ["meat", "veg", "soup"]],
    [mealSlotOrderStatusSchema, ["draft", "open", "closed"]],
    [bookingBatchStatusSchema, ["open", "closed", "archived"]],
    [orderStatusSchema, ["draft", "confirmed", "canceled"]],
    [orderSourceSchema, ["customer-card", "manual", "jielong-import"]],
    [paymentStatusSchema, ["unpaid", "paid"]],
    [deliveryStatusSchema, ["pending", "done"]]
  ] as const;

  it.each(cases)("接受声明值并拒绝未知值", (schema, values) => {
    for (const value of values) expect(schema.parse(value)).toBe(value);
    expect(schema.safeParse("unknown").success).toBe(false);
  });
});

describe("基础值 schemas", () => {
  it("只接受真实存在的 YYYY-MM-DD 日历日", () => {
    expect(calendarDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    expect(calendarDateSchema.safeParse("2024-02-30").success).toBe(false);
    expect(calendarDateSchema.safeParse("2024-2-9").success).toBe(false);
  });

  it("金额只接受非负整数", () => {
    expect(nonNegativeIntegerSchema.parse(0)).toBe(0);
    expect(nonNegativeIntegerSchema.safeParse(-1).success).toBe(false);
    expect(nonNegativeIntegerSchema.safeParse(1.5).success).toBe(false);
  });

  it("份数只接受正整数", () => {
    expect(positiveIntegerSchema.parse(1)).toBe(1);
    expect(positiveIntegerSchema.safeParse(0).success).toBe(false);
    expect(positiveIntegerSchema.safeParse(1.5).success).toBe(false);
  });
});

describe("实体输入 schemas", () => {
  it("校验 seller 与 operator", () => {
    expect(sellerInputSchema.parse({ name: " 桃子 ", defaultPriceCents: 3000 })).toEqual({
      name: "桃子",
      defaultPriceCents: 3000,
      status: "active"
    });
    expect(sellerInputSchema.safeParse({ name: "", defaultPriceCents: -1 }).success).toBe(false);

    expect(operatorInputSchema.parse({ seller: 1, wechatOpenid: " openid ", active: true })).toEqual({
      seller: 1,
      wechatOpenid: "openid",
      active: true
    });
    expect(operatorInputSchema.safeParse({ seller: 1, wechatOpenid: " " }).success).toBe(false);
  });

  it("允许顾客资料暂不绑定 openid，但称呼和地址必须成对有效", () => {
    expect(customerProfileInputSchema.parse({
      seller: "seller-1",
      openid: null,
      displayName: " 王阿姨 ",
      address: " 3A-1201 "
    })).toMatchObject({ openid: null, displayName: "王阿姨", address: "3A-1201", active: true });
    expect(customerProfileInputSchema.safeParse({
      seller: 1,
      displayName: "王阿姨",
      address: " "
    }).success).toBe(false);
  });

  it("校验菜品名称、主料与类别", () => {
    expect(offeringInputSchema.parse({
      seller: 1,
      name: " 番茄牛腩 ",
      mainIngredient: " 牛肉 ",
      category: "meat"
    })).toEqual({
      seller: 1,
      name: "番茄牛腩",
      mainIngredient: "牛肉",
      category: "meat",
      active: true
    });
    expect(offeringInputSchema.safeParse({ seller: 1, name: "菜", category: "staple" }).success).toBe(false);
  });

  it("校验餐次日历日、菜单快照和金额", () => {
    const result = mealSlotInputSchema.parse({
      seller: 1,
      date: "2026-07-10",
      occasion: "lunch",
      menuItems: [{
        offering: 2,
        nameSnapshot: "红烧肉",
        mainIngredientSnapshot: null,
        categorySnapshot: "meat"
      }],
      priceCents: 3000
    });
    expect(result).toMatchObject({ orderStatus: "draft", priceCents: 3000 });
    expect(mealSlotInputSchema.safeParse({ seller: 1, date: "2026-02-30", occasion: "lunch" }).success).toBe(false);
    expect(mealSlotInputSchema.safeParse({ seller: 1, date: "2026-07-10", occasion: "lunch", priceCents: -1 }).success).toBe(false);
  });

  it("预订批次至少关联一个餐次", () => {
    expect(bookingBatchInputSchema.parse({
      seller: 1,
      publicId: "public-random-id",
      title: "周末预订",
      mealSlots: [2],
      createdBy: 3
    })).toMatchObject({ status: "open", mealSlots: [2] });
    expect(bookingBatchInputSchema.safeParse({
      seller: 1,
      publicId: "id",
      title: "空批次",
      mealSlots: [],
      createdBy: 3
    }).success).toBe(false);
  });

  it("订单允许接龙兜底缺 profile/address，同时约束份数、金额和备注", () => {
    expect(orderInputSchema.parse({
      seller: 1,
      mealSlot: 2,
      customerProfile: null,
      source: "jielong-import",
      displayName: "群友",
      address: null,
      quantity: 2,
      unitPriceCents: 3000
    })).toMatchObject({
      customerProfile: null,
      status: "draft",
      paymentStatus: "unpaid",
      deliveryStatus: "pending"
    });
    expect(orderInputSchema.safeParse({
      seller: 1,
      mealSlot: 2,
      source: "manual",
      displayName: "桃子家",
      quantity: 0,
      unitPriceCents: 3000
    }).success).toBe(false);
    expect(orderInputSchema.safeParse({
      seller: 1,
      mealSlot: 2,
      source: "manual",
      displayName: "桃子家",
      quantity: 1,
      unitPriceCents: -1,
      note: "x".repeat(1001)
    }).success).toBe(false);
  });
});
