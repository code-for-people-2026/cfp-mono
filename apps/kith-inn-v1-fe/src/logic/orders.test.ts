import { describe, expect, it } from "vitest";
import type { Order, OrderSummary } from "@cfp/kith-inn-v1-shared";
import { ApiError } from "../services/api";
import {
  buildDraftEdit,
  buildManualOrderCreate,
  duplicateDraftUpdate,
  orderSummaryText,
  replaceOrder
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

describe("manual-order form logic", () => {
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

  it("builds non-empty draft edits with trimmed snapshots", () => {
    expect(buildDraftEdit({ quantity: "3", displayName: " 王姨 ", address: " 3A-1202 ", note: " 门口放 " }))
      .toEqual({ quantity: 3, displayName: "王姨", address: "3A-1202", note: "门口放" });
    expect(buildDraftEdit({ quantity: "1", displayName: "王姨", address: "3A", note: "" }))
      .toEqual({ quantity: 1, displayName: "王姨", address: "3A", note: null });
    expect(buildDraftEdit({ quantity: "0", displayName: "", address: "3A", note: "" })).toBeNull();
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
});
