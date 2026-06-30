import { describe, expect, it, vi } from "vitest";
import { CmsHttpError } from "../lib/cms/orders";
import { createCmsAgentServices, todayShanghai, type AgentCms } from "./services";

const NOW = () => new Date("2026-06-29T12:00:00+08:00");

const baseCms = (over: Partial<AgentCms> = {}): AgentCms => ({
  getSeller: over.getSeller ?? vi.fn(async () => ({ id: 1, name: "桃子", defaultPriceCents: 3000, status: "active" }) as never),
  findOfferings: over.findOfferings ?? vi.fn(async () => [{ id: 10, kind: "combo-meal", name: "4菜1汤套餐", priceCents: 3000 }] as never),
  getOrder: over.getOrder ?? vi.fn(async () => ({ id: 1, date: "2026-06-29", status: "draft", customer: { id: 5, kind: "regular" }, items: [] }) as never),
  createOrderDraft: over.createOrderDraft ?? vi.fn(async () => ({ order: { id: 90 }, items: [] }) as never),
  updateOrder: over.updateOrder ?? vi.fn(async () => ({ id: 90 }) as never),
  upsertSlots: over.upsertSlots ?? vi.fn(async () => [] as never),
  createFulfillments: over.createFulfillments ?? vi.fn(async () => [] as never),
  setFulfillmentsByOrderItems: over.setFulfillmentsByOrderItems ?? vi.fn(async () => undefined),
  listCustomers: over.listCustomers ?? vi.fn(async () => [{ id: 5, displayName: "王燕萍", kind: "regular" }] as never),
  listFulfillments: over.listFulfillments ?? vi.fn(async () => [] as never),
  listOrders: over.listOrders ?? vi.fn(async () => [] as never),
});

const svc = (cms: AgentCms) => createCmsAgentServices({ jwt: "jwt", cms, now: NOW });

describe("todayShanghai", () => {
  it("formats the Shanghai date YYYY-MM-DD off the injected clock", () => {
    expect(todayShanghai(() => new Date("2026-06-29T12:00:00+08:00"))).toBe("2026-06-29");
  });

  it("rolls over at the Shanghai midnight boundary (UTC 16:00 = next day)", () => {
    // 2026-06-29T23:30:00Z = 2026-06-30T07:30:00+08:00
    expect(todayShanghai(() => new Date("2026-06-29T23:30:00+00:00"))).toBe("2026-06-30");
  });
});

describe("recordOrder", () => {
  it("resolves name→customerId, picks the combo, records a draft", async () => {
    const cms = baseCms();
    const r = await svc(cms).recordOrder({ customerName: "王燕萍", quantity: 2, occasion: "lunch" });
    expect(r).toEqual({ ok: true, orderId: 90 });
    expect(cms.createOrderDraft).toHaveBeenCalledWith(
      "jwt",
      expect.objectContaining({
        customer: 5,
        date: "2026-06-29",
        source: "chat-paste",
        items: [expect.objectContaining({ offering: 10, mealOccasion: "lunch", quantity: 2 })],
      }),
    );
  });

  it("errors when the customer name is unknown", async () => {
    const cms = baseCms({ listCustomers: vi.fn(async () => []) });
    const r = await svc(cms).recordOrder({ customerName: "陌生人", quantity: 1, occasion: "dinner" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/没找到顾客/) });
  });

  it("errors when the pool has no combo offering", async () => {
    const cms = baseCms({ findOfferings: vi.fn(async () => [{ id: 11, kind: "component" }] as never) });
    const r = await svc(cms).recordOrder({ customerName: "王燕萍", quantity: 1, occasion: "lunch" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/没有套餐/) });
  });

  it("returns a generic error if the draft write throws", async () => {
    const cms = baseCms({ createOrderDraft: vi.fn(async () => { throw new Error("net"); }) });
    const r = await svc(cms).recordOrder({ customerName: "王燕萍", quantity: 1, occasion: "lunch" });
    expect(r).toEqual({ ok: false, error: "记单失败" });
  });
});

describe("confirmOrder", () => {
  it("materializes a draft order", async () => {
    const r = await svc(baseCms()).confirmOrder({ orderId: 1 });
    expect(r).toEqual({ ok: true });
  });

  it("reports not-draft without confirming", async () => {
    const cms = baseCms({ getOrder: vi.fn(async () => ({ id: 1, date: "2026-06-29", status: "confirmed", customer: { id: 5, kind: "regular" }, items: [] }) as never) });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: expect.stringMatching(/不是草稿/) });
  });

  it("reports an archived slot needs force reopen", async () => {
    const cms = baseCms({
      getOrder: vi.fn(async () => ({ id: 1, date: "2026-06-29", status: "draft", customer: { id: 5, kind: "regular" }, items: [{ id: 201, mealOccasion: "lunch", quantity: 1 }] }) as never),
      upsertSlots: vi.fn(async () => { throw new CmsHttpError(409, "x"); }),
    });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: "需先重开档期" });
  });

  it("returns a generic error on an unexpected failure", async () => {
    const cms = baseCms({ getOrder: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: "确认失败" });
  });
});

describe("cancelOrder", () => {
  it("cancels the order", async () => {
    expect(await svc(baseCms()).cancelOrder({ orderId: 1 })).toEqual({ ok: true });
  });

  it("returns a generic error on failure", async () => {
    const cms = baseCms({ getOrder: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).cancelOrder({ orderId: 1 })).toEqual({ ok: false, error: "取消失败" });
  });
});

describe("markPaid", () => {
  it("sets paymentStatus=paid + paidAt", async () => {
    const cms = baseCms();
    expect(await svc(cms).markPaid({ orderId: 90 })).toEqual({ ok: true });
    expect(cms.updateOrder).toHaveBeenCalledWith("jwt", 90, expect.objectContaining({ paymentStatus: "paid" }));
  });

  it("returns a generic error on failure", async () => {
    const cms = baseCms({ updateOrder: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).markPaid({ orderId: 90 })).toEqual({ ok: false, error: "标记失败" });
  });
});

describe("markDelivered", () => {
  const fs = [
    { orderItem: 201, addrBuilding: "26B", status: "pending" },
    { orderItem: 202, addrBuilding: "26B", addrUnit: "3F", status: "pending" },
    { orderItem: 203, addrBuilding: "26B", status: "canceled" },
  ];

  it("marks a whole building (skips canceled)", async () => {
    const cms = baseCms({ listFulfillments: vi.fn(async () => fs as never) });
    const r = await svc(cms).markDelivered({ building: "26B" });
    expect(r).toEqual({ ok: true, count: 2 });
    expect(cms.setFulfillmentsByOrderItems).toHaveBeenCalledWith("jwt", [201, 202], { status: "done" });
  });

  it("marks a single door when unit is given", async () => {
    const cms = baseCms({ listFulfillments: vi.fn(async () => fs as never) });
    expect(await svc(cms).markDelivered({ building: "26B", unit: "3F" })).toEqual({ ok: true, count: 1 });
  });

  it("is a no-op (count 0, no write) when nothing matches", async () => {
    const cms = baseCms({ listFulfillments: vi.fn(async () => fs as never) });
    expect(await svc(cms).markDelivered({ building: "99" })).toEqual({ ok: true, count: 0 });
    expect(cms.setFulfillmentsByOrderItems).not.toHaveBeenCalled();
  });

  it("returns a generic error on failure", async () => {
    const cms = baseCms({ listFulfillments: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).markDelivered({ building: "26B" })).toEqual({ ok: false, error: "标记失败" });
  });
});

describe("getTodaySummary", () => {
  it("counts drafts / confirmed-unpaid / pending deliveries + recent names", async () => {
    const cms = baseCms({
      listOrders: vi.fn(async () => [
        { status: "draft", customer: { displayName: "王燕萍" }, paymentStatus: "unpaid" },
        { status: "confirmed", customer: { displayName: "李叔" }, paymentStatus: "unpaid" },
        { status: "confirmed", customer: { displayName: "张三" }, paymentStatus: "paid" },
        { status: "canceled", customer: { displayName: "作废" }, paymentStatus: "unpaid" },
      ] as never),
      listFulfillments: vi.fn(async () => [
        { status: "pending", addrBuilding: "26B" },
        { status: "done", addrBuilding: "26B" },
        { status: "handed-off", addrBuilding: "1D" },
      ] as never),
    });
    const t = await svc(cms).getTodaySummary();
    expect(t).toEqual({
      unconfirmedOrders: 1,
      pendingDeliveries: 2,
      unpaidOrders: 1,
      recentOrders: "王燕萍 草稿；李叔；张三",
    });
  });

  it("degrades to zeros when the cms read fails", async () => {
    const cms = baseCms({ listOrders: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).getTodaySummary()).toEqual({ unconfirmedOrders: 0, pendingDeliveries: 0, unpaidOrders: 0, recentOrders: "" });
  });
});
