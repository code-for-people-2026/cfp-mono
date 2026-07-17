import { describe, expect, it } from "vitest";
import type { CustomerBookingBatchView, CustomerOrderView } from "@cfp/kith-inn-v1-shared";
import { customerOrderLabels, customerOrderLockText, customerOrderQuantity, customerWriteErrorText } from "./customerOrders";

const order = (overrides: Partial<CustomerOrderView> = {}): CustomerOrderView => ({
  id: 31, target: { date: "2026-07-13", occasion: "lunch" }, menuItems: [], orderStatus: "open",
  orderDeadline: "2026-07-12T01:00:00.000Z", displayName: "王阿姨", address: "3A", quantity: 2,
  unitPriceCents: 3000, totalCents: 6000, status: "draft", paymentStatus: "unpaid", paidAt: null,
  deliveryStatus: "pending", deliveredAt: null, confirmedAt: null, canceledAt: null, ...overrides
});
const batch = (overrides: Partial<CustomerBookingBatchView> = {}): CustomerBookingBatchView => ({
  sellerName: "桃子", title: "一周", status: "open", sharePath: "/pages/booking/index?batch=x",
  slots: [{ ...order().target, menuItems: [], unitPriceCents: 3000, orderDeadline: order().orderDeadline,
    canBook: true, unavailableReason: null }], ...overrides
});

describe("customer order presentation", () => {
  it("labels the three independent status axes", () => {
    expect(customerOrderLabels(order())).toEqual(["待桃子确认", "未付款", "待送达"]);
    expect(customerOrderLabels(order({ status: "confirmed", paymentStatus: "paid", deliveryStatus: "done" })))
      .toEqual(["桃子已确认", "已付款", "已送达"]);
    expect(customerOrderLabels(order({ status: "canceled" }))[0]).toBe("已取消");
  });

  it("allows writes only through the current writable batch", () => {
    expect(customerOrderLockText(order(), batch())).toBeNull();
    expect(customerOrderLockText(order({ status: "confirmed" }), batch())).toBe("桃子已确认，请在群里联系桃子");
    expect(customerOrderLockText(order({ status: "canceled" }), batch())).toBe("订单已取消");
    expect(customerOrderLockText(order(), null)).toBe("如需修改，请从预订卡片进入");
    expect(customerOrderLockText(order(), batch({ status: "closed" }))).toBe("本餐次已截止，请在群里联系桃子");
    expect(customerOrderLockText(order(), batch({ slots: [] }))).toBe("如需修改，请从预订卡片进入");
  });

  it("validates quantities and stabilizes race error copy", () => {
    expect(customerOrderQuantity(" 3 ")).toBe(3);
    expect(customerOrderQuantity("0")).toBeNull();
    expect(customerOrderQuantity("1.5")).toBeNull();
    expect(customerWriteErrorText({ code: "confirmed-order-locked" })).toBe("桃子已确认，请在群里联系桃子");
    expect(customerWriteErrorText({ code: "meal-slot-closed" })).toBe("本餐次已截止，请在群里联系桃子");
    expect(customerWriteErrorText(new Error("offline"))).toBe("操作失败，请刷新后重试");
  });
});
