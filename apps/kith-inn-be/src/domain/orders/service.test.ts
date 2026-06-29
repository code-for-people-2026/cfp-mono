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
  status: "draft",
  customer: { id: 5, kind: "regular", building: "1D", unit: "28D" },
  items: [
    { id: 201, mealOccasion: "lunch", quantity: 1 },
    { id: 202, mealOccasion: "dinner", quantity: 1 },
  ],
};

function mockCms(over: Partial<CmsMocks> = {}): CmsMocks {
  return {
    getSeller: over.getSeller ?? vi.fn<OrderCms["getSeller"]>(async () => ({ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" })),
    findOfferings: over.findOfferings ?? vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 1, name: "套餐", kind: "combo-meal", priceCents: 3000, seller: 7 }]),
    getOrder: over.getOrder ?? vi.fn<OrderCms["getOrder"]>(async () => draftDetail),
    createOrderDraft:
      over.createOrderDraft ??
      vi.fn<OrderCms["createOrderDraft"]>(async (_jwt, input) => ({ order: { id: 90, date: "2026-06-30", status: "draft", totalCents: input.totalCents } as Order, items: [] })),
    updateOrder: over.updateOrder ?? vi.fn<OrderCms["updateOrder"]>(async () => ({ id: 90, status: "confirmed" } as Order)),
    upsertSlots: over.upsertSlots ?? vi.fn<OrderCms["upsertSlots"]>(async () => []),
    createFulfillments: over.createFulfillments ?? vi.fn<OrderCms["createFulfillments"]>(async () => []),
    setFulfillmentsByOrderItems: over.setFulfillmentsByOrderItems ?? vi.fn<OrderCms["setFulfillmentsByOrderItems"]>(async () => undefined),
  };
}

describe("recordDraft", () => {
  it("snapshots per-item prices + totalCents and creates the draft (zero side effects)", async () => {
    const cms = mockCms();
    await recordDraft(JWT, { customer: 5, date: "2026-06-30", source: "chat-paste", items: [{ offering: 1, mealOccasion: "lunch", quantity: 2 }] }, cms);
    expect(cms.getSeller).toHaveBeenCalledWith(JWT);
    expect(cms.createOrderDraft).toHaveBeenCalledWith(JWT, expect.objectContaining({ totalCents: 6000 }));
    expect(cms.createOrderDraft.mock.calls[0]![1].items[0]).toMatchObject({ offering: 1, quantity: 2, unitPriceCents: 3000 });
  });

  it("falls back to seller.defaultPriceCents when the offering has no price", async () => {
    const cms = mockCms({ findOfferings: vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 9, name: "x", kind: "component", seller: 7 }]) });
    await recordDraft(JWT, { customer: 5, date: "2026-06-30", source: "manual", items: [{ offering: 9, mealOccasion: "lunch", quantity: 1 }] }, cms);
    expect(cms.createOrderDraft.mock.calls[0]![1].items[0]!.unitPriceCents).toBe(3000);
  });
});

describe("confirmOrder", () => {
  it("opens one slot per distinct occasion, creates a delivery fulfillment per item, sets confirmed", async () => {
    const cms = mockCms();
    await confirmOrder(JWT, 90, cms);
    expect(cms.upsertSlots).toHaveBeenCalledWith(JWT, [
      { date: "2026-06-30", occasion: "lunch", granularity: "occasion" },
      { date: "2026-06-30", occasion: "dinner", granularity: "occasion" },
    ]);
    expect(cms.createFulfillments).toHaveBeenCalledWith(
      JWT,
      expect.arrayContaining([
        expect.objectContaining({ orderItem: 201, mode: "delivery", status: "pending", addrBuilding: "1D", addrUnit: "28D" }),
        expect.objectContaining({ orderItem: 202, serviceDate: "2026-06-30", occasion: "dinner" }),
      ]),
    );
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 90, { status: "confirmed" });
  });

  it("creates NO fulfillment for a self/onsite customer", async () => {
    const selfDetail: OrderDetail = { id: 91, date: "2026-06-30", status: "draft", customer: { id: 1, kind: "self" }, items: [{ id: 300, mealOccasion: "dinner", quantity: 6 }] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => selfDetail) });
    await confirmOrder(JWT, 91, cms);
    expect(cms.upsertSlots).toHaveBeenCalledOnce(); // still opens the dinner slot
    expect(cms.createFulfillments).not.toHaveBeenCalled();
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 91, { status: "confirmed" });
  });

  it("throws not-draft when the order is already confirmed", async () => {
    const confirmed: OrderDetail = { id: 90, date: "x", status: "confirmed", customer: { id: 1, kind: "regular" }, items: [] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => confirmed) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toMatchObject({ code: "not-draft" });
    expect(cms.upsertSlots).not.toHaveBeenCalled();
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
    expect(cms.setFulfillmentsByOrderItems).toHaveBeenCalledWith(JWT, [201, 202], { status: "canceled" });
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 90, { status: "canceled" });
  });

  it("is idempotent — a no-op on an already-canceled order", async () => {
    const canceled: OrderDetail = { id: 90, date: "x", status: "canceled", customer: { id: 1, kind: "regular" }, items: [{ id: 1, quantity: 1 }] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => canceled) });
    await cancelOrder(JWT, 90, cms);
    expect(cms.setFulfillmentsByOrderItems).not.toHaveBeenCalled();
    expect(cms.updateOrder).not.toHaveBeenCalled();
  });

  it("skips fulfillment cancel when the order has no items", async () => {
    const empty: OrderDetail = { id: 90, date: "x", status: "draft", customer: { id: 1, kind: "regular" }, items: [] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => empty) });
    await cancelOrder(JWT, 90, cms);
    expect(cms.setFulfillmentsByOrderItems).not.toHaveBeenCalled();
    expect(cms.updateOrder).toHaveBeenCalledWith(JWT, 90, { status: "canceled" });
  });
});
