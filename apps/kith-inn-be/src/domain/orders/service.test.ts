import type { Order } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { OrderDetail } from "../../lib/cms/orders";
import { CmsHttpError } from "../../lib/cms/orders";
import type { OrderCms } from "./service";
import { cancelOrder, confirmOrder, recordDraft } from "./service";

// `Mock<...>` per method so `.mock` is reachable and literals don't widen.
type CmsMocks = { [K in keyof OrderCms]: Mock<OrderCms[K]> };

const JWT = "jwt";

const draftDetail: OrderDetail = {
  id: 90,
  date: "2026-06-30",
  occasion: "lunch",
  status: "draft",
  customer: { id: 5, address: "1D-28D" },
  items: [{ id: 201, quantity: 1 }],
};

function mockCms(over: Partial<CmsMocks> = {}): CmsMocks {
  return {
    getSeller: over.getSeller ?? vi.fn<OrderCms["getSeller"]>(async () => ({ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" })),
    findOfferings: over.findOfferings ?? vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 1, name: "套餐", kind: "combo-meal", priceCents: 3000, seller: 7 }]),
    getOrder: over.getOrder ?? vi.fn<OrderCms["getOrder"]>(async () => draftDetail),
    createOrderDraft:
      over.createOrderDraft ??
      vi.fn<OrderCms["createOrderDraft"]>(async (_jwt, input) => ({ order: { id: 90, date: "2026-06-30", occasion: input.occasion, status: "draft", totalCents: input.totalCents } as Order, items: [] })),
    updateOrder: over.updateOrder ?? vi.fn<OrderCms["updateOrder"]>(async () => ({ id: 90, status: "confirmed" } as Order)),
    upsertSlots: over.upsertSlots ?? vi.fn<OrderCms["upsertSlots"]>(async () => []),
    createFulfillments: over.createFulfillments ?? vi.fn<OrderCms["createFulfillments"]>(async () => []),
    setFulfillmentsByOrders: over.setFulfillmentsByOrders ?? vi.fn<OrderCms["setFulfillmentsByOrders"]>(async () => undefined),
  };
}

describe("recordDraft", () => {
  it("snapshots per-item prices + totalCents and creates the draft (zero side effects)", async () => {
    const cms = mockCms();
    await recordDraft(JWT, { customer: 5, date: "2026-06-30", occasion: "lunch", source: "chat-paste", items: [{ offering: 1, quantity: 2 }] }, cms);
    expect(cms.getSeller).toHaveBeenCalledWith(JWT);
    expect(cms.createOrderDraft).toHaveBeenCalledWith(JWT, expect.objectContaining({ totalCents: 6000 }));
    expect(cms.createOrderDraft.mock.calls[0]![1].items[0]).toMatchObject({ offering: 1, quantity: 2, unitPriceCents: 3000 });
  });

  it("falls back to seller.defaultPriceCents when the offering has no price", async () => {
    const cms = mockCms({ findOfferings: vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 9, name: "x", kind: "component", seller: 7 }]) });
    await recordDraft(JWT, { customer: 5, date: "2026-06-30", occasion: "lunch", source: "manual", items: [{ offering: 9, quantity: 1 }] }, cms);
    expect(cms.createOrderDraft.mock.calls[0]![1].items[0]!.unitPriceCents).toBe(3000);
  });

  it("rejects empty drafts before any cms write", async () => {
    const cms = mockCms();
    await expect(recordDraft(JWT, { customer: 5, date: "2026-06-30", occasion: "lunch", source: "manual", items: [] }, cms)).rejects.toMatchObject({ code: "empty-order" });
    expect(cms.getSeller).not.toHaveBeenCalled();
    expect(cms.createOrderDraft).not.toHaveBeenCalled();
  });
});

describe("confirmOrder", () => {
  it("opens the order occasion slot, creates one fulfillment, sets confirmed", async () => {
    const cms = mockCms();
    await confirmOrder(JWT, 90, cms);
    expect(cms.upsertSlots).toHaveBeenCalledWith(JWT, [
      { date: "2026-06-30", occasion: "lunch", granularity: "occasion" },
    ]);
    expect(cms.createFulfillments).toHaveBeenCalledWith(
      JWT,
      expect.arrayContaining([
        expect.objectContaining({ order: 90, serviceDate: "2026-06-30", occasion: "lunch", status: "pending" }),
      ]),
    );
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 90, { status: "confirmed" });
  });

  it("throws not-draft when the order is already confirmed", async () => {
    const confirmed: OrderDetail = { id: 90, date: "x", occasion: "lunch", status: "confirmed", customer: { id: 1 }, items: [] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => confirmed) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toMatchObject({ code: "not-draft" });
    expect(cms.upsertSlots).not.toHaveBeenCalled();
  });

  it("does not materialize an empty draft", async () => {
    const empty: OrderDetail = { id: 90, date: "x", occasion: "lunch", status: "draft", customer: { id: 1 }, items: [] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => empty) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toMatchObject({ code: "empty-order" });
    expect(cms.upsertSlots).not.toHaveBeenCalled();
    expect(cms.createFulfillments).not.toHaveBeenCalled();
    expect(cms.updateOrder).not.toHaveBeenCalled();
  });

  it("surfaces an archived slot (cms 409) as slot-archived", async () => {
    const cms = mockCms({ upsertSlots: vi.fn<OrderCms["upsertSlots"]>(async () => { throw new CmsHttpError(409, "cms slot upsert"); }) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toMatchObject({ code: "slot-archived" });
    expect(cms.createFulfillments).not.toHaveBeenCalled();
    expect(cms.updateOrder).not.toHaveBeenCalled();
  });

  it("rethrows non-409 cms errors unchanged", async () => {
    const cms = mockCms({ upsertSlots: vi.fn<OrderCms["upsertSlots"]>(async () => { throw new CmsHttpError(500, "cms slot upsert"); }) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toThrow(/500/);
  });
});

describe("cancelOrder", () => {
  it("cancels the order and all its fulfillments", async () => {
    const cms = mockCms();
    await cancelOrder(JWT, 90, cms);
    expect(cms.setFulfillmentsByOrders).toHaveBeenCalledWith(JWT, [90], { status: "canceled" });
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 90, { status: "canceled" });
  });

  it("is idempotent — a no-op on an already-canceled order", async () => {
    const canceled: OrderDetail = { id: 90, date: "x", occasion: "lunch", status: "canceled", customer: { id: 1 }, items: [{ id: 1, quantity: 1 }] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => canceled) });
    await cancelOrder(JWT, 90, cms);
    expect(cms.setFulfillmentsByOrders).not.toHaveBeenCalled();
    expect(cms.updateOrder).not.toHaveBeenCalled();
  });

  it("cancels fulfillments by order id even when the order has no items loaded", async () => {
    const empty: OrderDetail = { id: 90, date: "x", occasion: "lunch", status: "draft", customer: { id: 1 }, items: [] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => empty) });
    await cancelOrder(JWT, 90, cms);
    expect(cms.setFulfillmentsByOrders).toHaveBeenCalledWith(JWT, [90], { status: "canceled" });
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 90, { status: "canceled" });
  });
});
