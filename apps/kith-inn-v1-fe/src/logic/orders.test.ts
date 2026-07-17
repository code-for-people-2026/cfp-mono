import { describe, expect, it, vi } from "vitest";
import type { MealSlot, Order, OrderSummary } from "@cfp/kith-inn-v1-shared";
import { ApiError } from "../services/api";
import {
  availableOrderActions,
  buildManualOrderCreate,
  buildOrderEdit,
  bulkDeliveryFeedback,
  copyOrderChecklist,
  duplicateDraftUpdate,
  orderAddressText,
  orderChecklistText,
  merchantOrdersPageNotice,
  orderResubmitInput,
  orderStateText,
  orderSummaryText,
  replaceOrder,
  toggleBulkOrderSelection
} from "./orders";

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
  unitPriceCents: 3000,
  totalCents: 6000,
  paymentStatus: "unpaid",
  paidAt: null,
  deliveryStatus: "pending",
  deliveredAt: null,
  confirmedAt: null,
  canceledAt: null,
  note: null,
  ...overrides
});

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

describe("manual-order form logic", () => {
  it("distinguishes idle, loading, error and empty order pages", () => {
    expect(merchantOrdersPageNotice("idle", 0)).toBe("请填写日期并查看午餐或晚餐订单");
    expect(merchantOrdersPageNotice("loading", 0)).toBe("正在加载餐次订单…");
    expect(merchantOrdersPageNotice("error", 0)).toBe("餐次订单加载失败，请检查日期后重试");
    expect(merchantOrdersPageNotice("loaded", 0)).toBe("当前餐次还没有订单，可在下方补录草稿");
    expect(merchantOrdersPageNotice("loaded", 1)).toBeNull();
  });

  it("builds an existing-profile order or a complete new profile", () => {
    expect(buildManualOrderCreate({
      mealSlotId: 11,
      customerProfileId: 21,
      displayName: "",
      address: "",
      quantity: "2",
      note: " 少辣 "
    })).toEqual({ mealSlotId: 11, customerProfileId: 21, quantity: 2, note: "少辣" });
    expect(buildManualOrderCreate({
      mealSlotId: 11,
      customerProfileId: null,
      displayName: " 李叔 ",
      address: " 2B-901 ",
      quantity: "1",
      note: ""
    })).toEqual({
      mealSlotId: 11,
      newProfile: { displayName: "李叔", address: "2B-901" },
      quantity: 1,
      note: null
    });
  });

  it("rejects incomplete profiles and invalid quantities", () => {
    const base = {
      mealSlotId: 11,
      customerProfileId: null,
      displayName: "王阿姨",
      address: "3A",
      quantity: "0",
      note: ""
    };
    expect(buildManualOrderCreate(base)).toBeNull();
    expect(buildManualOrderCreate({ ...base, quantity: "1", address: " " })).toBeNull();
    expect(buildManualOrderCreate({ ...base, quantity: "1.5" })).toBeNull();
  });

  it("builds trimmed edits and explicit confirmed impact acceptance", () => {
    const form = { quantity: "3", displayName: " 王姨 ", address: " 3A-1202 ", note: " 门口放 " };
    expect(buildOrderEdit(form))
      .toEqual({ quantity: 3, displayName: "王姨", address: "3A-1202", note: "门口放" });
    expect(buildOrderEdit(form, true))
      .toEqual({
        quantity: 3,
        displayName: "王姨",
        address: "3A-1202",
        note: "门口放",
        confirmedImpactAccepted: true
      });
    expect(buildOrderEdit({ quantity: "1", displayName: "王姨", address: "3A", note: "" }))
      .toEqual({ quantity: 1, displayName: "王姨", address: "3A", note: null });
    expect(buildOrderEdit({ quantity: "0", displayName: "", address: "3A", note: "" })).toBeNull();
  });

  it("omits immutable imported snapshots from edit requests", () => {
    const form = { quantity: "3", displayName: "", address: "", note: " 门口放 " };
    expect(buildOrderEdit(form, false, "jielong-import")).toEqual({ quantity: 3, note: "门口放" });
    expect(buildOrderEdit(form, true, "jielong-import")).toEqual({
      quantity: 3,
      note: "门口放",
      confirmedImpactAccepted: true
    });
    expect(buildOrderEdit({ ...form, quantity: "0" }, false, "jielong-import")).toBeNull();
  });

  it("turns only an active duplicate into an explicit same-id draft update", () => {
    const input = { mealSlotId: 11, customerProfileId: 21, quantity: 3, note: "少辣" } as const;
    expect(duplicateDraftUpdate(new ApiError(409, "order-exists", "已存在", {
      existing: { id: 31, status: "draft", quantity: 2 }
    }), input)).toEqual({ id: 31, patch: { quantity: 3, note: "少辣" } });
    expect(duplicateDraftUpdate(new ApiError(409, "canceled-order-exists", "已取消", {
      existing: { id: 31, status: "canceled", quantity: 2 }
    }), input)).toBeNull();
    expect(duplicateDraftUpdate(new Error("offline"), input)).toBeNull();
    expect(duplicateDraftUpdate(new ApiError(409, "order-exists", "坏数据", {}), input)).toBeNull();
    expect(duplicateDraftUpdate(new ApiError(409, "order-exists", "坏数据", { existing: null }), input)).toBeNull();
    expect(duplicateDraftUpdate(new ApiError(409, "order-exists", "坏数据", {
      existing: { id: null, status: "draft" }
    }), input)).toBeNull();
    expect(duplicateDraftUpdate(new ApiError(409, "order-exists", "已取消", {
      existing: { id: "order-31", status: "canceled" }
    }), input)).toBeNull();
    expect(duplicateDraftUpdate(new ApiError(409, "order-exists", "已存在", {
      existing: { id: "order-31", status: "draft" }
    }), input)).toEqual({ id: "order-31", patch: { quantity: 3, note: "少辣" } });
  });
});

describe("order-list view logic", () => {
  it("selects single-order actions and renders three independent state axes", () => {
    expect(availableOrderActions(order())).toEqual(["confirm", "cancel"]);
    expect(availableOrderActions(order({ status: "confirmed" })))
      .toEqual(["cancel", "mark-paid", "mark-delivered"]);
    expect(availableOrderActions(order({
      status: "confirmed",
      paymentStatus: "paid",
      deliveryStatus: "done"
    }))).toEqual(["cancel", "mark-unpaid", "mark-pending-delivery"]);
    expect(availableOrderActions(order({ status: "canceled" }))).toEqual(["resubmit"]);
    expect(availableOrderActions(order({
      status: "canceled",
      source: "jielong-import",
      customerProfileId: null,
      address: null
    }))).toEqual([]);
    expect(orderStateText(order({ status: "confirmed", paymentStatus: "paid", deliveryStatus: "done" })))
      .toBe("业务：已确认；付款：已付；配送：已送");
    expect(orderStateText(order())).toBe("业务：草稿；付款：未付；配送：待送");
  });

  it("reuses the current snapshots for explicit canceled-order resubmit", () => {
    expect(orderResubmitInput(order({
      status: "canceled",
      quantity: 4,
      displayName: "王姨",
      address: "3A-1202",
      note: "门口放"
    }))).toEqual({ quantity: 4, displayName: "王姨", address: "3A-1202", note: "门口放" });
  });

  it("renders the four confirmed-only summary counters", () => {
    const summary: OrderSummary = { confirmedOrders: 2, totalQuantity: 5, unpaid: 1, pendingDelivery: 2 };
    expect(orderSummaryText(summary)).toBe("已确认 2 单，共 5 份；未付 1 单，待送 2 单");
  });

  it("replaces the same order id and keeps address/name ordering", () => {
    const first = order({ id: 31, address: "3A", displayName: "王阿姨" });
    const second = order({ id: 32, address: "2B", displayName: "李叔" });
    const replacement = { ...first, quantity: 4, totalCents: 12_000 };
    expect(replaceOrder([first, second], replacement)).toEqual([second, replacement]);
    const sameAddress = order({ id: 33, address: "2B", displayName: "阿姨" });
    expect(replaceOrder([second], sameAddress)).toEqual([sameAddress, second]);
    const sameName = order({ id: 30, address: "2B", displayName: "李叔" });
    expect(replaceOrder([second], sameName)).toEqual([sameName, second]);
  });

  it("renders and stably sorts imported orders without an address", () => {
    const imported = order({
      id: 38,
      source: "jielong-import",
      customerProfileId: null,
      address: null,
      displayName: "接龙顾客",
      status: "confirmed",
      confirmedAt: "2026-07-10T00:00:00.000Z"
    });
    const addressed = order({ id: 37, address: "3A", status: "confirmed" });
    expect(orderAddressText(imported)).toBe("无地址");
    expect(() => orderResubmitInput(imported)).toThrow("接龙导入订单没有地址，不能沿用手工重提");
    expect(replaceOrder([imported], addressed)).toEqual([addressed, imported]);
    expect(orderChecklistText(slot, [imported, addressed])).toContain("无地址｜接龙顾客｜2 份");
  });

  it("explicitly selects only confirmed orders and reports every bulk result", () => {
    const confirmed = order({ status: "confirmed", confirmedAt: "2026-07-10T00:00:00.000Z" });
    expect(toggleBulkOrderSelection([], confirmed)).toEqual([31]);
    expect(toggleBulkOrderSelection([31], confirmed)).toEqual([]);
    expect(toggleBulkOrderSelection([], order())).toEqual([]);
    expect(toggleBulkOrderSelection([], order({ status: "canceled" }))).toEqual([]);
    expect(bulkDeliveryFeedback([
      { id: 31, status: "updated" },
      { id: "order-32", status: "failed", error: "invalid-order-transition" }
    ])).toEqual([
      "订单 31：已送",
      "订单 order-32：失败（invalid-order-transition）"
    ]);
  });

  it("builds and copies a confirmed-only checklist in address/name/id order", async () => {
    const orders = [
      order({ id: 35, status: "confirmed", confirmedAt: "2026-07-10T00:00:00.000Z", address: "3A", quantity: 2 }),
      order({ id: 34, status: "confirmed", confirmedAt: "2026-07-10T00:00:00.000Z", address: "2B", displayName: "李叔", quantity: 1, totalCents: 3000 }),
      order({ id: 32, status: "confirmed", confirmedAt: "2026-07-10T00:00:00.000Z", address: "2B", displayName: "李叔", quantity: 1, totalCents: 3000 }),
      order({ id: 33, status: "confirmed", confirmedAt: "2026-07-10T00:00:00.000Z", address: "2B", displayName: "阿姨", quantity: 3, totalCents: 9000 }),
      order({ id: 36, status: "draft", address: "1A", displayName: "草稿" }),
      order({ id: 37, status: "canceled", address: "1A", displayName: "取消" })
    ];
    const text = [
      "餐次：2026-07-13 午餐",
      "总份数：7",
      "2B｜阿姨｜3 份",
      "2B｜李叔｜1 份",
      "2B｜李叔｜1 份",
      "3A｜王阿姨｜2 份"
    ].join("\n");
    expect(orderChecklistText(slot, orders)).toBe(text);
    const setClipboardData = vi.fn(async () => undefined);
    await copyOrderChecklist(slot, orders, setClipboardData);
    expect(setClipboardData).toHaveBeenCalledWith({ data: text });
    expect(orderChecklistText({ ...slot, occasion: "dinner" }, []))
      .toBe("餐次：2026-07-13 晚餐\n总份数：0");
  });
});
