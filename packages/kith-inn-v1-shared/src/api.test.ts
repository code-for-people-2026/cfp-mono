import { describe, expect, it } from "vitest";
import {
  apiErrorSchema,
  authResponseSchema,
  bulkMarkDeliveredInputSchema,
  bulkMarkDeliveredResponseSchema,
  cmsCustomerProfileSchema,
  cmsOrderCreateSchema,
  cmsOrderUpdateSchema,
  customerProfileCreateSchema,
  customerProfileSchema,
  customerProfilesResponseSchema,
  devLoginInputSchema,
  importCommitInputSchema,
  importCommitResponseSchema,
  importPreviewInputSchema,
  importPreviewResponseSchema,
  generateMenusInputSchema,
  generateMenusResponseSchema,
  mealSlotRangeSchema,
  mealSlotSchema,
  mealSlotsExistErrorSchema,
  manualOrderCreateSchema,
  manualOrderUpdateSchema,
  orderActionResponseSchema,
  orderActionSchema,
  orderExistsErrorSchema,
  orderListQuerySchema,
  orderListResponseSchema,
  orderMutationResponseSchema,
  orderResubmitSchema,
  orderSchema,
  orderStateErrorSchema,
  offeringPoolInsufficientErrorSchema,
  offeringCreateSchema,
  offeringSchema,
  offeringUpdateSchema,
  selectSellerInputSchema,
  sellerSnapshotSchema,
  swapMenuItemInputSchema,
  swapMenuItemResponseSchema,
  wxLoginInputSchema
} from "./api";

describe("auth API schemas", () => {
  it("accepts authenticated and seller-selection responses", () => {
    expect(authResponseSchema.parse({
      status: "authenticated",
      token: "token",
      session: {
        operatorId: 1,
        sellerId: 7,
        sellerName: "桃子",
        role: "operator",
        expiresAt: "2027-01-01T00:00:00.000Z"
      }
    }).status).toBe("authenticated");
    expect(authResponseSchema.parse({
      status: "seller-selection-required",
      selectionToken: "selection",
      sellers: [{ sellerId: 7, sellerName: "桃子" }, { sellerId: 8, sellerName: "邻居" }]
    }).status).toBe("seller-selection-required");
  });

  it("rejects leaked openid, invalid requests and incomplete errors", () => {
    expect(authResponseSchema.safeParse({
      status: "authenticated",
      token: "token",
      session: { operatorId: 1, sellerId: 7, sellerName: "桃子", role: "operator", expiresAt: "bad", openid: "leak" }
    }).success).toBe(false);
    expect(wxLoginInputSchema.safeParse({ code: "", openid: "leak" }).success).toBe(false);
    expect(devLoginInputSchema.safeParse({ openid: "" }).success).toBe(false);
    expect(selectSellerInputSchema.safeParse({ selectionToken: "", sellerId: 7 }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ error: "bad" }).success).toBe(false);
  });
});

describe("offering API schemas", () => {
  const offering = {
    id: 10,
    sellerId: 7,
    name: "番茄牛腩",
    mainIngredient: "牛肉",
    category: "meat",
    active: true
  };

  it("accepts normalized entities and create/update allowlists", () => {
    expect(offeringSchema.parse(offering)).toEqual(offering);
    expect(offeringCreateSchema.parse({ name: " 番茄牛腩 ", mainIngredient: null, category: "meat" })).toEqual({
      name: "番茄牛腩",
      mainIngredient: null,
      category: "meat"
    });
    expect(offeringUpdateSchema.parse({ active: false })).toEqual({ active: false });
  });

  it("rejects empty/long/invalid fields, empty patches and any seller field", () => {
    expect(offeringCreateSchema.safeParse({ name: "", category: "meat" }).success).toBe(false);
    expect(offeringCreateSchema.safeParse({ name: "x".repeat(81), category: "veg" }).success).toBe(false);
    expect(offeringCreateSchema.safeParse({ name: "菜", mainIngredient: "x".repeat(81), category: "soup" }).success).toBe(false);
    expect(offeringCreateSchema.safeParse({ name: "菜", category: "unknown" }).success).toBe(false);
    expect(offeringCreateSchema.safeParse({ seller: 99, name: "菜", category: "veg" }).success).toBe(false);
    expect(offeringUpdateSchema.safeParse({}).success).toBe(false);
    expect(offeringUpdateSchema.safeParse({ seller: 99, active: false }).success).toBe(false);
    expect(offeringSchema.safeParse({ ...offering, mainIngredient: undefined }).success).toBe(false);
  });
});

describe("offering import API schemas", () => {
  const parsed = { name: "番茄牛腩", mainIngredient: "牛肉", category: "meat" };

  it("accepts ready/conflict/invalid preview rows and summary", () => {
    const response = importPreviewResponseSchema.parse({
      rows: [
        { line: 1, raw: "番茄牛腩 牛肉 荤", parsed, status: "ready", defaultAction: "create" },
        { line: 2, raw: "番茄牛腩 牛肉 荤", parsed, status: "conflict", existingId: 10, defaultAction: "skip" },
        { line: 3, raw: "坏数据", status: "invalid", error: "缺少分类" }
      ],
      summary: { ready: 1, conflict: 1, invalid: 1 }
    });
    expect(response.rows).toHaveLength(3);
  });

  it("accepts per-line commit outcomes and defaults conflict choices to empty", () => {
    expect(importCommitInputSchema.parse({ text: "菜 素" })).toEqual({ text: "菜 素", conflicts: [] });
    expect(importCommitInputSchema.parse({
      text: "菜 素",
      conflicts: [{ line: 2, action: "overwrite" }]
    }).conflicts).toHaveLength(1);
    expect(importCommitResponseSchema.parse({
      results: [
        { line: 1, status: "created", id: 1 },
        { line: 2, status: "overwritten", id: 2 },
        { line: 3, status: "skipped", id: 3 },
        { line: 4, status: "failed", error: "写入失败" }
      ],
      summary: { created: 1, overwritten: 1, skipped: 1, failed: 1 }
    }).results).toHaveLength(4);
  });

  it("rejects malformed row/result combinations, duplicate actions and seller injection", () => {
    expect(importPreviewInputSchema.safeParse({ text: "", seller: 7 }).success).toBe(false);
    expect(importPreviewResponseSchema.safeParse({
      rows: [{ line: 1, raw: "菜", status: "ready", error: "wrong shape" }],
      summary: { ready: 1, conflict: 0, invalid: 0 }
    }).success).toBe(false);
    expect(importCommitInputSchema.safeParse({
      text: "菜 素",
      conflicts: [{ line: 1, action: "overwrite" }, { line: 1, action: "overwrite" }],
      seller: 7
    }).success).toBe(false);
    expect(importCommitResponseSchema.safeParse({
      results: [{ line: 1, status: "failed", id: 1 }],
      summary: { created: 0, overwritten: 0, skipped: 0, failed: 1 }
    }).success).toBe(false);
  });
});

describe("meal-slot API schemas", () => {
  const target = { date: "2026-07-13", occasion: "lunch" };
  const menuItems = [
    { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
    { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
    { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
    { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
    { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
  ];
  const slot = {
    id: 11,
    sellerId: 7,
    ...target,
    menuItems,
    orderStatus: "draft",
    priceCents: null,
    generatedAt: "2026-07-10T01:00:00.000Z"
  };

  it("accepts valid 31-day ranges and rejects reversed or longer ranges", () => {
    expect(mealSlotRangeSchema.parse({ from: "2026-07-01", to: "2026-07-31" })).toEqual({
      from: "2026-07-01",
      to: "2026-07-31"
    });
    expect(mealSlotRangeSchema.safeParse({ from: "2026-07-31", to: "2026-07-01" }).success).toBe(false);
    expect(mealSlotRangeSchema.safeParse({ from: "2026-07-01", to: "2026-08-01" }).success).toBe(false);
    expect(mealSlotRangeSchema.safeParse({ from: "bad", to: "2026-07-01" }).success).toBe(false);
  });

  it("deduplicates targets, limits the result to 20 and rejects seller injection", () => {
    expect(generateMenusInputSchema.parse({ targets: [target, target] })).toEqual({
      targets: [target],
      replaceExisting: false
    });
    const twentyOne = Array.from({ length: 21 }, (_, day) => ({
      date: `2026-07-${String(day + 1).padStart(2, "0")}`,
      occasion: "lunch"
    }));
    expect(generateMenusInputSchema.safeParse({ targets: twentyOne }).success).toBe(false);
    expect(generateMenusInputSchema.safeParse({ targets: [target], seller: 99 }).success).toBe(false);
    expect(generateMenusInputSchema.safeParse({ targets: [] }).success).toBe(false);
  });

  it("validates meal-slot, generation and swap response envelopes", () => {
    expect(mealSlotSchema.parse(slot)).toEqual(slot);
    expect(generateMenusResponseSchema.parse({ docs: [slot], relaxedRules: ["recent-offering"] }).docs).toHaveLength(1);
    expect(swapMenuItemInputSchema.parse({ offeringId: 1 })).toEqual({ offeringId: 1 });
    expect(swapMenuItemResponseSchema.parse({ doc: slot, relaxedRules: [] }).doc.id).toBe(11);
    expect(generateMenusResponseSchema.safeParse({ docs: [slot], relaxedRules: ["unknown"] }).success).toBe(false);
    expect(swapMenuItemInputSchema.safeParse({ offeringId: 1, seller: 99 }).success).toBe(false);
    expect(mealSlotSchema.safeParse({ ...slot, menuItems: menuItems.slice(1) }).success).toBe(false);
  });

  it("validates actionable existing/insufficient errors", () => {
    expect(mealSlotsExistErrorSchema.parse({
      error: "meal-slots-exist",
      message: "餐次已存在",
      existingTargets: [target]
    }).existingTargets).toEqual([target]);
    expect(offeringPoolInsufficientErrorSchema.parse({
      error: "offering-pool-insufficient",
      message: "菜品池不足",
      shortages: [{ category: "soup", required: 1, available: 0 }]
    }).shortages[0]).toEqual({ category: "soup", required: 1, available: 0 });
    expect(mealSlotsExistErrorSchema.safeParse({ error: "meal-slots-exist", message: "x", existingTargets: [] }).success).toBe(false);
    expect(offeringPoolInsufficientErrorSchema.safeParse({
      error: "offering-pool-insufficient",
      message: "x",
      shortages: [{ category: "other", required: 1, available: 0 }]
    }).success).toBe(false);
  });
});

describe("manual order API schemas", () => {
  const profile = {
    id: 21,
    sellerId: 7,
    displayName: "王阿姨",
    address: "3A-1201",
    active: true
  };
  const slot = {
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
  const order = {
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
    note: "少辣"
  };

  it("accepts seller/profile and draft-order response envelopes", () => {
    expect(sellerSnapshotSchema.parse({ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" }))
      .toMatchObject({ id: 7, defaultPriceCents: 3000 });
    expect(customerProfileSchema.parse(profile)).toEqual(profile);
    expect(cmsCustomerProfileSchema.parse({ ...profile, openid: null })).toEqual({ ...profile, openid: null });
    expect(customerProfilesResponseSchema.parse({ docs: [profile] })).toEqual({ docs: [profile] });
    expect(orderSchema.parse(order)).toEqual(order);
    expect(orderListResponseSchema.parse({
      mealSlot: slot,
      docs: [order],
      summary: { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 }
    }).docs).toEqual([order]);
    expect(orderMutationResponseSchema.parse({ doc: order, profile }).profile).toEqual(profile);
  });

  it("accepts exactly one profile source and non-empty draft edits", () => {
    expect(manualOrderCreateSchema.parse({ mealSlotId: 11, customerProfileId: 21, quantity: 2 })).toEqual({
      mealSlotId: 11,
      customerProfileId: 21,
      quantity: 2,
      note: null
    });
    expect(manualOrderCreateSchema.parse({
      mealSlotId: 11,
      newProfile: { displayName: " 王阿姨 ", address: " 3A-1201 " },
      quantity: 1,
      note: ""
    })).toEqual({
      mealSlotId: 11,
      newProfile: { displayName: "王阿姨", address: "3A-1201" },
      quantity: 1,
      note: ""
    });
    expect(manualOrderUpdateSchema.parse({ quantity: 3, address: "3A-1202" })).toEqual({
      quantity: 3,
      address: "3A-1202"
    });
    expect(orderListQuerySchema.parse({ date: "2026-07-13", occasion: "lunch" })).toEqual({
      date: "2026-07-13",
      occasion: "lunch"
    });
    expect(customerProfileCreateSchema.parse({ displayName: "王阿姨", address: "3A-1201" })).toEqual({
      displayName: "王阿姨",
      address: "3A-1201"
    });
  });

  it("validates CMS persistence input and actionable duplicate summaries", () => {
    const persisted = {
      mealSlotId: 11,
      customerProfileId: 21,
      customerOpenid: null,
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
      note: null
    };
    expect(cmsOrderCreateSchema.parse(persisted)).toEqual(persisted);
    expect(orderExistsErrorSchema.parse({
      error: "order-exists",
      message: "订单已存在",
      existing: { id: 31, status: "draft", quantity: 2 }
    }).existing.id).toBe(31);
    expect(orderExistsErrorSchema.parse({
      error: "canceled-order-exists",
      message: "已取消订单需要明确重提",
      existing: { id: 31, status: "canceled", quantity: 2 }
    }).error).toBe("canceled-order-exists");
    expect(orderExistsErrorSchema.parse({
      error: "order-exists",
      message: "已确认订单已存在",
      existing: { id: 31, status: "confirmed", quantity: 2 }
    }).existing.status).toBe("confirmed");
  });

  it("validates lifecycle actions, confirmed edits and CMS persistence patches", () => {
    const actions = [
      "confirm",
      "cancel",
      "resubmit",
      "mark-paid",
      "mark-unpaid",
      "mark-delivered",
      "mark-pending-delivery"
    ];
    expect(actions.map((action) => orderActionSchema.parse(action))).toEqual(actions);
    expect(orderActionResponseSchema.parse({ doc: order }).doc).toEqual(order);
    expect(orderResubmitSchema.parse({
      quantity: 3,
      displayName: " 王姨 ",
      address: " 3A-1202 ",
      note: "门口放"
    })).toEqual({ quantity: 3, displayName: "王姨", address: "3A-1202", note: "门口放" });
    expect(manualOrderUpdateSchema.parse({ quantity: 3, confirmedImpactAccepted: true }))
      .toEqual({ quantity: 3, confirmedImpactAccepted: true });
    expect(cmsOrderUpdateSchema.parse({
      status: "confirmed",
      confirmedAt: "2026-07-11T00:00:00.000Z",
      canceledAt: null,
      paymentStatus: "paid",
      paidAt: "2026-07-11T00:01:00.000Z",
      deliveryStatus: "done",
      deliveredAt: "2026-07-11T00:02:00.000Z"
    })).toMatchObject({ status: "confirmed", paymentStatus: "paid", deliveryStatus: "done" });
    expect(orderStateErrorSchema.parse({
      error: "invalid-order-transition",
      message: "状态转换无效"
    }).error).toBe("invalid-order-transition");
    expect(orderStateErrorSchema.parse({
      error: "confirmed-impact-confirmation-required",
      message: "需要确认影响"
    }).error).toBe("confirmed-impact-confirmation-required");
  });

  it("deduplicates at most 100 bulk delivery ids and validates per-order results", () => {
    expect(bulkMarkDeliveredInputSchema.parse({ ids: [31, 31, "order-32"] }))
      .toEqual({ ids: [31, "order-32"] });
    expect(bulkMarkDeliveredResponseSchema.parse({
      results: [
        { id: 31, status: "updated" },
        { id: "order-32", status: "failed", error: "invalid-order-transition" }
      ]
    }).results).toHaveLength(2);
    expect(bulkMarkDeliveredInputSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(bulkMarkDeliveredInputSchema.safeParse({
      ids: Array.from({ length: 101 }, (_, index) => index + 1)
    }).success).toBe(false);
    expect(bulkMarkDeliveredInputSchema.safeParse({ ids: [31], seller: 7 }).success).toBe(false);
    expect(bulkMarkDeliveredResponseSchema.safeParse({
      results: [{ id: 31, status: "failed" }]
    }).success).toBe(false);
    expect(bulkMarkDeliveredResponseSchema.safeParse({
      results: [{ id: 31, status: "updated", error: "not-found" }]
    }).success).toBe(false);
  });

  it("rejects seller/openid injection, invalid profile choices and malformed order data", () => {
    expect(customerProfileCreateSchema.safeParse({ displayName: "王阿姨", address: "3A", openid: "leak" }).success).toBe(false);
    expect(manualOrderCreateSchema.safeParse({ mealSlotId: 11, quantity: 1 }).success).toBe(false);
    expect(manualOrderCreateSchema.safeParse({
      mealSlotId: 11,
      customerProfileId: 21,
      newProfile: { displayName: "王阿姨", address: "3A" },
      quantity: 1
    }).success).toBe(false);
    expect(manualOrderCreateSchema.safeParse({ mealSlotId: 11, customerProfileId: 21, quantity: 0 }).success).toBe(false);
    expect(manualOrderCreateSchema.safeParse({ mealSlotId: 11, customerProfileId: 21, quantity: 1, seller: 99 }).success).toBe(false);
    expect(manualOrderUpdateSchema.safeParse({}).success).toBe(false);
    expect(manualOrderUpdateSchema.safeParse({ confirmedImpactAccepted: true }).success).toBe(false);
    expect(manualOrderUpdateSchema.safeParse({ quantity: 2, confirmedImpactAccepted: false }).success).toBe(false);
    expect(manualOrderUpdateSchema.safeParse({ status: "confirmed" }).success).toBe(false);
    expect(orderActionSchema.safeParse("bulk-mark-delivered").success).toBe(false);
    expect(orderResubmitSchema.safeParse({ quantity: 1, displayName: "王姨", address: "3A", note: null, seller: 7 }).success)
      .toBe(false);
    expect(cmsOrderUpdateSchema.safeParse({}).success).toBe(false);
    expect(cmsOrderUpdateSchema.safeParse({ status: "confirmed", confirmedImpactAccepted: true }).success).toBe(false);
    expect(orderListQuerySchema.safeParse({ date: "2026-02-30", occasion: "lunch" }).success).toBe(false);
    expect(orderSchema.safeParse({ ...order, totalCents: 5999 }).success).toBe(false);
    expect(cmsOrderCreateSchema.safeParse({ ...order, seller: 99 }).success).toBe(false);
    expect(orderExistsErrorSchema.safeParse({
      error: "canceled-order-exists",
      message: "x",
      existing: { id: 31, status: "confirmed", quantity: 2 }
    }).success).toBe(false);
  });
});
