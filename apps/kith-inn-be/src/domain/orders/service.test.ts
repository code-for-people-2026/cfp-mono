import type { Order } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi, type Mock } from "vitest";
import { CmsHttpError } from "../../lib/cms/orders";
import type { OrderCms } from "./service";
import { cancelOrder, confirmOrder, recordDraft } from "./service";

type CmsMocks = { [K in keyof OrderCms]: Mock<OrderCms[K]> };
const JWT = "jwt";

function mockCms(over: Partial<CmsMocks> = {}): CmsMocks {
  return {
    getSeller: over.getSeller ?? vi.fn<OrderCms["getSeller"]>(async () => ({ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" })),
    findOfferings: over.findOfferings ?? vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 1, name: "套餐", kind: "combo-meal", priceCents: 3000, seller: 7 }]),
    getOrder: over.getOrder ?? vi.fn<OrderCms["getOrder"]>(async () => ({ id: 90, date: "2026-06-30", occasion: "lunch", status: "draft", customer: { id: 5 }, items: [{ id: 201, quantity: 1 }] })),
    createOrderDraft:
      over.createOrderDraft ??
      vi.fn<OrderCms["createOrderDraft"]>(async (_jwt, input) => ({ order: { id: 90, date: "2026-06-30", occasion: input.occasion, status: "draft", totalCents: input.totalCents } as Order, items: [] })),
    confirmOrderAtomic: over.confirmOrderAtomic ?? vi.fn<OrderCms["confirmOrderAtomic"]>(async () => ({ slots: [], fulfillments: [] })),
    cancelOrderAtomic: over.cancelOrderAtomic ?? vi.fn<OrderCms["cancelOrderAtomic"]>(async () => undefined),
    updateOrder: over.updateOrder ?? vi.fn<OrderCms["updateOrder"]>(async () => ({ id: 90, status: "confirmed" } as Order)),
  };
}

describe("recordDraft", () => {
  it("snapshots per-item prices + totalCents and creates the draft", async () => {
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
  it("delegates the complete lifecycle to one atomic cms call", async () => {
    const cms = mockCms();
    await expect(confirmOrder(JWT, 90, cms)).resolves.toEqual({ slots: [], fulfillments: [] });
    expect(cms.confirmOrderAtomic).toHaveBeenCalledWith(JWT, 90);
  });

  it.each([
    ["not-draft", "not-draft"],
    ["empty-order", "empty-order"],
    ["slot-archived", "slot-archived"],
  ] as const)("maps cms %s to OrderStateError", async (code, expected) => {
    const cms = mockCms({ confirmOrderAtomic: vi.fn<OrderCms["confirmOrderAtomic"]>(async () => { throw new CmsHttpError(409, "confirm", code); }) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toMatchObject({ code: expected });
  });

  it("rethrows unknown cms failures", async () => {
    const error = new CmsHttpError(500, "confirm");
    const cms = mockCms({ confirmOrderAtomic: vi.fn<OrderCms["confirmOrderAtomic"]>(async () => { throw error; }) });
    await expect(confirmOrder(JWT, 90, cms)).rejects.toBe(error);
  });
});

describe("cancelOrder", () => {
  it("delegates order + fulfillment cancellation to one atomic cms call", async () => {
    const cms = mockCms();
    await cancelOrder(JWT, 90, cms);
    expect(cms.cancelOrderAtomic).toHaveBeenCalledWith(JWT, 90);
  });

  it("rethrows cms failures", async () => {
    const cms = mockCms({ cancelOrderAtomic: vi.fn<OrderCms["cancelOrderAtomic"]>(async () => { throw new Error("net"); }) });
    await expect(cancelOrder(JWT, 90, cms)).rejects.toThrow("net");
  });
});
