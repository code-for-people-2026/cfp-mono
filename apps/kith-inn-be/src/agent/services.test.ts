import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/deepseek/client", () => ({ callDeepSeek: vi.fn() }));

import { CmsHttpError } from "../lib/cms/orders";
import { callDeepSeek } from "../lib/deepseek/client";
import { createCmsAgentServices, type AgentCms } from "./services";
import { todayShanghai } from "../lib/domainUtil";

const NOW = () => new Date("2026-06-29T12:00:00+08:00");

const baseCms = (over: Partial<AgentCms> = {}): AgentCms => ({
  getSeller: over.getSeller ?? vi.fn(async () => ({ id: 1, name: "桃子", defaultPriceCents: 3000, status: "active" }) as never),
  findOfferings: over.findOfferings ?? vi.fn(async () => [{ id: 10, kind: "combo-meal", name: "4菜1汤套餐", priceCents: 3000 }] as never),
  getOrder: over.getOrder ?? vi.fn(async () => ({ id: 1, date: "2026-06-29", occasion: "lunch", status: "draft", customer: { id: 5 }, items: [{ id: 201, quantity: 1 }] }) as never),
  createOrderDraft: over.createOrderDraft ?? vi.fn(async () => ({ order: { id: 90 }, items: [] }) as never),
  confirmOrderAtomic: over.confirmOrderAtomic ?? vi.fn(async () => ({ slots: [], fulfillments: [] })),
  cancelOrderAtomic: over.cancelOrderAtomic ?? vi.fn(async () => undefined),
  updateOrder: over.updateOrder ?? vi.fn(async () => ({ id: 90 }) as never),
  setFulfillmentsByIds: over.setFulfillmentsByIds ?? vi.fn(async () => undefined),
  listCustomers: over.listCustomers ?? vi.fn(async () => [{ id: 5, displayName: "王燕萍" }] as never),
  createCustomer: over.createCustomer ?? vi.fn(async () => ({ id: 55, displayName: "大龙猫" }) as never),
  listFulfillments: over.listFulfillments ?? vi.fn(async () => [] as never),
  listOrders: over.listOrders ?? vi.fn(async () => [] as never),
  reconcileOrders: over.reconcileOrders ?? vi.fn(async () => ({ ok: true as const, created: [], updated: [], canceled: [], unchanged: [] })),
  listMenuPlans: over.listMenuPlans ?? vi.fn(async () => [] as never),
  getMenuPlan: over.getMenuPlan ?? vi.fn(async () => ({}) as never),
  upsertMenuPlans: over.upsertMenuPlans ?? vi.fn(async () => [] as never),
  patchMenuPlan: over.patchMenuPlan ?? vi.fn(async () => ({}) as never),
  createOffering: over.createOffering ?? vi.fn(async () => ({}) as never),
});

const OP = 1;
const svc = (cms: AgentCms) => createCmsAgentServices({ jwt: "jwt", cms, operatorId: OP, now: NOW });
const component = (id: number, name: string, mainIngredient: string, active = true) => ({ id, kind: "component", name, category: "meat", mainIngredient, active });
const planWith = (offerings: unknown[], over: Record<string, unknown> = {}) => ({
  id: 50, status: "draft", slot: { date: "2026-06-29T00:00:00.000Z", occasion: "lunch" }, offerings, ...over,
});

describe("production order parsing and preview", () => {
  it("uses the injected Shanghai today as the parser reference date", async () => {
    vi.mocked(callDeepSeek).mockResolvedValueOnce(JSON.stringify({
      mode: "snapshot",
      scope: [{ date: "2026-06-29", occasion: "lunch", dateEvidence: "6.29号星期一午餐" }],
      items: [{ customerName: "王燕萍", date: "2026-06-29", occasion: "lunch", quantity: 1, evidence: "王燕萍1份" }],
      unknownSegments: [],
    }));
    const result = await svc(baseCms()).parseOrders("6.29号星期一午餐 王燕萍1份");
    expect(result.issues).toEqual([]);
    expect(vi.mocked(callDeepSeek).mock.calls[0]?.[0].messages[0]?.content).toContain("2026-06-29");
  });

  it("classifies known and new names without supplying a fallback date", async () => {
    const result = await svc(baseCms()).previewOrders([
      { customerName: "王燕萍", date: "2026-06-29", occasion: "lunch", quantity: 1 },
      { customerName: "大龙猫", date: "2026-06-29", occasion: "dinner", quantity: 1 },
    ]);
    expect(result).toEqual({ isNew: [false, true] });
  });

  it("builds a seller-scoped snapshot diff with combo pricing", async () => {
    const cms = baseCms({
      findOfferings: vi.fn(async () => [
        { id: 9, kind: "combo-meal", name: "已停用套餐", priceCents: 9999, active: false },
        { id: 10, kind: "combo-meal", name: "4菜1汤套餐", priceCents: 3000, active: true },
      ] as never),
      listOrders: vi.fn(async () => [{
        id: 90,
        customer: { id: 5, displayName: "王燕萍" },
        date: "2026-06-29T00:00:00.000Z",
        occasion: "lunch",
        status: "draft",
        paymentStatus: "unpaid",
        updatedAt: "2026-06-29T01:00:00.000Z",
        items: [{ id: 201, offering: 10, quantity: 1, unitPriceCents: 3000 }],
      }] as never),
    });
    const preview = await svc(cms).previewOrderReconciliation({
      mode: "snapshot",
      scope: [{ date: "2026-06-29", occasion: "lunch", dateEvidence: "6.29午餐" }],
      items: [{ customerName: "王燕萍", date: "2026-06-29", occasion: "lunch", quantity: 2, evidence: "王燕萍2份" }],
      unknownSegments: [],
      issues: [],
    }, "op-1");
    expect(preview).toMatchObject({ operationKey: "op-1", candidates: [{ customer: 5, offering: 10, quantity: 2, totalCents: 6000 }], rows: [{ kind: "update", beforeQuantity: 1, afterQuantity: 2 }] });
    expect(cms.listOrders).toHaveBeenCalledWith("jwt", { date: "2026-06-29", occasion: "lunch" });
  });

  it("builds an increment add preview from the current target quantity", async () => {
    const cms = baseCms({
      listOrders: vi.fn(async () => [{
        id: 90, customer: { id: 5, displayName: "王燕萍" }, date: "2026-06-29", occasion: "lunch", status: "draft", paymentStatus: "unpaid", updatedAt: "2026-06-29T01:00:00.000Z",
        items: [{ id: 201, offering: 10, quantity: 1, unitPriceCents: 3000 }],
      }, {
        id: 91, customer: { id: 6, displayName: "李叔叔" }, date: "2026-06-29", occasion: "lunch", status: "draft", paymentStatus: "unpaid", updatedAt: "2026-06-29T01:00:00.000Z",
        items: [{ id: 202, offering: 10, quantity: 4, unitPriceCents: 3000 }],
      }] as never),
    });
    const preview = await svc(cms).previewOrderReconciliation({
      mode: "increment",
      operation: "add",
      operationEvidence: "加",
      scope: [{ date: "2026-06-29", occasion: "lunch", dateEvidence: "6.29午餐" }],
      items: [{ customerName: "王燕萍", date: "2026-06-29", occasion: "lunch", quantity: 2, evidence: "加王燕萍2份" }],
      unknownSegments: [],
      issues: [],
    }, "op-add");

    expect(preview).toMatchObject({ mode: "increment", operation: "add", candidates: [{ customer: 5, quantity: 2 }] });
    expect(preview.rows).toEqual([expect.objectContaining({ kind: "add", beforeQuantity: 1, changeQuantity: 2, afterQuantity: 3 })]);
  });

  it("uses a populated order customer when the separate customer read is stale", async () => {
    const cms = baseCms({
      listCustomers: vi.fn(async () => []),
      listOrders: vi.fn(async () => [{
        id: 90,
        customer: { id: 5, displayName: "王燕萍" },
        date: "2026-06-29",
        occasion: "lunch",
        status: "draft",
        paymentStatus: "unpaid",
        updatedAt: "2026-06-29T01:00:00.000Z",
        items: [{ id: 201, offering: 10, quantity: 1, unitPriceCents: 3000 }],
      }] as never),
    });
    const preview = await svc(cms).previewOrderReconciliation({
      mode: "snapshot",
      scope: [{ date: "2026-06-29", occasion: "lunch", dateEvidence: "6.29午餐" }],
      items: [{ customerName: "王燕萍", date: "2026-06-29", occasion: "lunch", quantity: 2, evidence: "王燕萍2份" }],
      unknownSegments: [],
      issues: [],
    }, "op-stale-customers");

    expect(preview).toMatchObject({
      candidates: [{ customer: 5, quantity: 2 }],
      rows: [{ kind: "update", customerName: "王燕萍", beforeQuantity: 1, afterQuantity: 2 }],
    });
  });

  it("joins fulfillment state and blocks changing a delivered order", async () => {
    const cms = baseCms({
      listOrders: vi.fn(async () => [{
        id: 90, customer: { id: 5, displayName: "王燕萍" }, date: "2026-06-29", occasion: "lunch", status: "confirmed", paymentStatus: "unpaid", updatedAt: "2026-06-29T01:00:00.000Z",
        items: [{ id: 201, offering: 10, quantity: 1, unitPriceCents: 3000 }],
      }] as never),
      listFulfillments: vi.fn(async () => [{ id: 301, order: 90, status: "done" }] as never),
    });
    const parsed = {
      mode: "snapshot" as const,
      scope: [{ date: "2026-06-29", occasion: "lunch" as const, dateEvidence: "6.29午餐" }],
      items: [{ customerName: "王燕萍", date: "2026-06-29", occasion: "lunch" as const, quantity: 2, evidence: "王燕萍2份" }],
      unknownSegments: [], issues: [],
    };

    await expect(svc(cms).previewOrderReconciliation(parsed, "op-delivered")).rejects.toMatchObject({ code: "settled-order" });
    expect(cms.listFulfillments).toHaveBeenCalledWith("jwt", { date: "2026-06-29", occasion: "lunch" });
  });

  it("forwards the immutable reconciliation request to CMS", async () => {
    const reconcileOrders = vi.fn(async () => ({ ok: true as const, created: [], updated: [], canceled: [], unchanged: [] }));
    const service = svc(baseCms({ reconcileOrders }));
    const request = { mode: "snapshot" as const, operationKey: "op", scope: [{ date: "2026-06-29", occasion: "lunch" as const }], expectedFingerprint: "fp", candidates: [] };
    await expect(service.reconcileOrders(request)).resolves.toMatchObject({ ok: true });
    expect(reconcileOrders).toHaveBeenCalledWith("jwt", request);
  });
});

describe("todayShanghai", () => {
  it("formats the Shanghai date YYYY-MM-DD off the injected clock", () => {
    expect(todayShanghai(() => new Date("2026-06-29T12:00:00+08:00"))).toBe("2026-06-29");
  });

  it("rolls over at the Shanghai midnight boundary (UTC 16:00 = next day)", () => {
    // 2026-06-29T23:30:00Z = 2026-06-30T07:30:00+08:00
    expect(todayShanghai(() => new Date("2026-06-29T23:30:00+00:00"))).toBe("2026-06-30");
  });
});

describe("recordOrders", () => {
  it("records drafts for known customers, collects unknown into needsConfirmation", async () => {
    const cms = baseCms();
    const r = await svc(cms).recordOrders([
      { customerName: "王燕萍", address: "1D-1201", quantity: 2, occasion: "lunch", date: "2026-06-29" },
      { customerName: "大龙猫", address: "26B-301", quantity: 1, occasion: "dinner", date: "2026-06-29" },
    ]);
    expect(r.recorded).toEqual([{ name: "王燕萍", orderId: 90 }]);
    expect(r.needsConfirmation).toEqual([{ customerName: "大龙猫", address: "26B-301", quantity: 1, occasion: "dinner", date: "2026-06-29" }]);
    expect(r.failed).toEqual([]);
    expect(cms.createOrderDraft).toHaveBeenCalledWith(
      "jwt",
      expect.objectContaining({
        customer: 5,
        date: "2026-06-29",
        occasion: "lunch",
        source: "chat-paste",
        items: [expect.objectContaining({ offering: 10, quantity: 2 })],
      }),
    );
  });

  it("does NOT create a customer or record for unknown names", async () => {
    const cms = baseCms({ listCustomers: vi.fn(async () => []) });
    const r = await svc(cms).recordOrders([{ customerName: "陌生人", quantity: 1, occasion: "dinner", date: "2026-06-29" }]);
    expect(r.recorded).toEqual([]);
    expect(r.needsConfirmation).toHaveLength(1);
    expect(cms.createCustomer).not.toHaveBeenCalled();
    expect(cms.createOrderDraft).not.toHaveBeenCalled();
  });

  it("fails an item when the pool has no combo offering", async () => {
    const cms = baseCms({ findOfferings: vi.fn(async () => [{ id: 11, kind: "component" }] as never) });
    const r = await svc(cms).recordOrders([{ customerName: "王燕萍", quantity: 1, occasion: "lunch", date: "2026-06-29" }]);
    expect(r.recorded).toEqual([]);
    expect(r.failed).toEqual([{ customerName: "王燕萍", error: "没有套餐商品，记不了单" }]);
  });

  it("collects a per-item failure when the draft write throws (batch continues)", async () => {
    const cms = baseCms({ createOrderDraft: vi.fn(async () => { throw new Error("net"); }) });
    const r = await svc(cms).recordOrders([{ customerName: "王燕萍", quantity: 1, occasion: "lunch", date: "2026-06-29" }]);
    expect(r.failed).toEqual([{ customerName: "王燕萍", error: "记单失败" }]);
  });

  it("fails every item when the cms read throws", async () => {
    const cms = baseCms({ listCustomers: vi.fn(async () => { throw new Error("net"); }) });
    const r = await svc(cms).recordOrders([{ customerName: "王燕萍", quantity: 1, occasion: "lunch", date: "2026-06-29" }]);
    expect(r.failed).toHaveLength(1);
  });

  it("returns new customers in needsConfirmation (preview flow splits them later, #126)", async () => {
    const cms = baseCms({ listCustomers: vi.fn(async () => []) });
    const r = await svc(cms).recordOrders([{ customerName: "大龙猫", address: "26B", quantity: 1, occasion: "dinner", date: "2026-06-29" }]);
    expect(r.needsConfirmation).toEqual([{ customerName: "大龙猫", address: "26B", quantity: 1, occasion: "dinner", date: "2026-06-29" }]);
  });

  it("carries a non-default date into needsConfirmation (Codex P1 — 明天 ≠ today)", async () => {
    const cms = baseCms({ listCustomers: vi.fn(async () => []) });
    const r = await svc(cms).recordOrders([{ customerName: "大龙猫", address: "26B", quantity: 1, occasion: "dinner", date: "2026-07-01" }]);
    expect(r.needsConfirmation).toEqual([{ customerName: "大龙猫", address: "26B", quantity: 1, occasion: "dinner", date: "2026-07-01" }]);
  });

  it("returns empty needsConfirmation when all customers are known", async () => {
    const cms = baseCms();
    const r = await svc(cms).recordOrders([{ customerName: "王燕萍", quantity: 1, occasion: "lunch", date: "2026-06-29" }]);
    expect(r.needsConfirmation).toEqual([]);
  });
});

describe("createCustomersAndOrders", () => {
  it("creates each customer then records a draft, returns created", async () => {
    const cms = baseCms({
      createCustomer: vi.fn(async (_jwt, input) => ({ id: 55, displayName: input.displayName }) as never),
    });
    const r = await svc(cms).createCustomersAndOrders([
      { displayName: "大龙猫", address: "26B-301", quantity: 1, occasion: "dinner", date: "2026-06-29" },
    ]);
    expect(r.created).toEqual([{ name: "大龙猫", orderId: 90 }]);
    expect(cms.createCustomer).toHaveBeenCalledWith("jwt", { displayName: "大龙猫", address: "26B-301" });
    expect(cms.createOrderDraft).toHaveBeenCalledWith(
      "jwt",
      expect.objectContaining({ customer: 55, occasion: "dinner", source: "chat-paste", items: [expect.objectContaining({ quantity: 1 })] }),
    );
  });

  it("collects per-item failures without aborting the batch", async () => {
    let i = 0;
    const cms = baseCms({
      createCustomer: vi.fn(async () => {
        i++;
        if (i === 1) throw new Error("net");
        return { id: 56, displayName: "x" } as never;
      }),
    });
    const r = await svc(cms).createCustomersAndOrders([
      { displayName: "坏", quantity: 1, occasion: "lunch", date: "2026-06-29" },
      { displayName: "好", quantity: 1, occasion: "lunch", date: "2026-06-29" },
    ]);
    expect(r.created).toHaveLength(1);
    expect(r.failed).toEqual([{ displayName: "坏", error: "建顾客或记单失败" }]);
  });

  it("fails when the pool has no combo", async () => {
    const cms = baseCms({ findOfferings: vi.fn(async () => [{ id: 11, kind: "component" }] as never) });
    const r = await svc(cms).createCustomersAndOrders([{ displayName: "大龙猫", quantity: 1, occasion: "lunch", date: "2026-06-29" }]);
    expect(r.created).toEqual([]);
    expect(r.failed).toEqual([{ displayName: "大龙猫", error: "没有套餐商品，记不了单" }]);
  });
});

describe("confirmOrder", () => {
  it("materializes a draft order", async () => {
    const r = await svc(baseCms()).confirmOrder({ orderId: 1 });
    expect(r).toEqual({ ok: true });
  });

  it("reports not-draft without confirming", async () => {
    const cms = baseCms({ confirmOrderAtomic: vi.fn(async () => { throw new CmsHttpError(409, "x", "not-draft"); }) });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: expect.stringMatching(/不是草稿/) });
  });

  it("reports empty drafts without confirming", async () => {
    const cms = baseCms({ confirmOrderAtomic: vi.fn(async () => { throw new CmsHttpError(409, "x", "empty-order"); }) });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: "订单没有明细，不能确认" });
    expect(cms.confirmOrderAtomic).toHaveBeenCalledOnce();
  });

  it("reports an archived slot needs force reopen", async () => {
    const cms = baseCms({
      confirmOrderAtomic: vi.fn(async () => { throw new CmsHttpError(409, "x", "slot-archived"); }),
    });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: "需先重开档期" });
  });

  it("returns a generic error on an unexpected failure", async () => {
    const cms = baseCms({ confirmOrderAtomic: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).confirmOrder({ orderId: 1 })).toEqual({ ok: false, error: "确认失败" });
  });
});

describe("cancelOrder", () => {
  it("cancels the order", async () => {
    expect(await svc(baseCms()).cancelOrder({ orderId: 1 })).toEqual({ ok: true });
  });

  it("returns a generic error on failure", async () => {
    const cms = baseCms({ cancelOrderAtomic: vi.fn(async () => { throw new Error("net"); }) });
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

describe("markUnpaid", () => {
  it("revokes the complete manual arrival record", async () => {
    const cms = baseCms();
    expect(await svc(cms).markUnpaid({ orderId: 90 })).toEqual({ ok: true });
    expect(cms.updateOrder).toHaveBeenCalledWith("jwt", 90, {
      paymentStatus: "unpaid",
      paidAt: null,
      paymentMethod: null,
    });
  });

  it("returns a generic error on failure", async () => {
    const cms = baseCms({ updateOrder: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).markUnpaid({ orderId: 90 })).toEqual({ ok: false, error: "回退失败" });
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
        { status: "pending" },
        { status: "done" },
        { status: "canceled" },
      ] as never),
    });
    const t = await svc(cms).getTodaySummary();
    expect(t).toEqual({
      unconfirmedOrders: 1,
      pendingDeliveries: 1,
      unpaidOrders: 1,
      recentOrders: "王燕萍 草稿；李叔；张三",
    });
  });

  it("degrades to zeros when the cms read fails", async () => {
    const cms = baseCms({ listOrders: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).getTodaySummary()).toEqual({ unconfirmedOrders: 0, pendingDeliveries: 0, unpaidOrders: 0, recentOrders: "" });
  });
});

describe("getTodayOrders", () => {
  it("returns today's active orders (canceled dropped)", async () => {
    const cms = baseCms({
      listOrders: vi.fn(async () => [
        { id: 1, status: "draft", customer: { displayName: "王燕萍" }, date: "2026-06-29", paymentStatus: "unpaid", items: [{ quantity: 2 }] },
        { id: 2, status: "canceled", customer: { displayName: "X" }, date: "2026-06-29", paymentStatus: "unpaid", items: [] },
      ] as never),
    });
    expect((await svc(cms).getTodayOrders()).map((o) => o.id)).toEqual([1]);
  });

  it("degrades to [] on cms failure", async () => {
    const cms = baseCms({ listOrders: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).getTodayOrders()).toEqual([]);
  });
});

describe("getTodayDelivery", () => {
  const f = (id: number, addr: string, status: string) => ({ id, order: { id: 1, address: addr }, status });

  it("groups by address with done/total + totalPending (canceled dropped)", async () => {
    const cms = baseCms({
      listFulfillments: vi.fn(async () => [f(11, "26B", "pending"), f(12, "26B", "done"), f(13, "1D", "pending"), f(14, "1D", "canceled")] as never),
    });
    const d = await svc(cms).getTodayDelivery();
    expect(d.totalPending).toBe(2); // 2 pending; canceled + done not counted
    const g = Object.fromEntries(d.groups.map((x) => [x.address, x]));
    expect(g["26B"]).toEqual({ address: "26B", count: 2, done: 1, total: 2, ids: [11, 12] });
    expect(g["1D"]).toEqual({ address: "1D", count: 1, done: 0, total: 1, ids: [13] }); // canceled filtered before packingSort
  });

  it("degrades to empty on cms failure", async () => {
    const cms = baseCms({ listFulfillments: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).getTodayDelivery()).toEqual({ totalPending: 0, groups: [] });
  });
});

describe("generateMenu", () => {
  it("blocks an already-published ISO-dated plan without force", async () => {
    const cms = baseCms({
      listMenuPlans: vi.fn(async () => [{ status: "published", slot: { date: "2026-06-29T00:00:00.000Z", occasion: "lunch" } }] as never),
    });
    expect(await svc(cms).generateMenu([{ date: "2026-06-29", occasion: "lunch" }])).toEqual({ ok: false, reason: "plan-published" });
    expect(cms.upsertMenuPlans).not.toHaveBeenCalled();
  });

  it("writes previewed offering ids instead of recomputing random choices", async () => {
    const cms = baseCms({
      findOfferings: vi.fn(async () => { throw new Error("should not recompute"); }),
      upsertMenuPlans: vi.fn(async () => [{
        id: 50,
        status: "draft",
        slot: { date: "2026-06-29T00:00:00.000Z", occasion: "lunch" },
        offerings: [{ id: 9, name: "预览菜", category: "meat", mainIngredient: "牛" }],
      }] as never),
    });
    const plannedItems = [{ date: "2026-06-29", occasion: "lunch" as const, offerings: [9, 8, 7, 6, 5] }];
    const r = await svc(cms).generateMenu([{ date: "2026-06-29", occasion: "lunch" }], false, plannedItems);
    expect(r.ok).toBe(true);
    expect(cms.findOfferings).not.toHaveBeenCalled();
    expect(cms.upsertMenuPlans).toHaveBeenCalledWith("jwt", [{ ...plannedItems[0], status: "draft" }]);
  });
});

describe("swapDish", () => {
  it("uses target history, excludes the current plan, and patches only the resolved duplicate position", async () => {
    const [target, used, conflict, clean] = [component(1, "牛腩", "牛"), component(2, "白切鸡", "鸡"), component(3, "鱼排", "鱼"), component(4, "排骨", "猪")];
    const current = planWith([target, used, target]);
    const listMenuPlans = vi.fn(async () => [planWith([clean]), planWith([conflict], { id: 51, slot: { date: "2026-06-28", occasion: "dinner" } })] as never);
    const patchMenuPlan = vi.fn(async (_jwt, _id, patch) => ({ ...current, ...patch }) as never);
    const cms = baseCms({ getMenuPlan: vi.fn(async () => current as never), findOfferings: vi.fn(async () => [target, used, conflict, clean] as never), listMenuPlans, patchMenuPlan });

    expect(await svc(cms).swapDish(50, 1)).toMatchObject({ ok: true, relaxedRules: [] });
    expect(listMenuPlans).toHaveBeenCalledWith("jwt", { from: "2026-06-22", to: "2026-07-05" });
    expect(patchMenuPlan).toHaveBeenCalledWith("jwt", 50, { offerings: [4, 2, 1] });
  });

  it("uses an explicit preview position and keeps published protection/force clearing", async () => {
    const [target, used, replacement] = [component(1, "牛腩", "牛"), component(2, "白切鸡", "鸡"), component(3, "鱼排", "鱼")];
    const published = planWith([target, used, target], { status: "published", publishText: "旧文案" });
    const patchMenuPlan = vi.fn(async (_jwt, _id, patch) => ({ ...published, ...patch }) as never);
    const cms = baseCms({ getMenuPlan: vi.fn(async () => published as never), findOfferings: vi.fn(async () => [target, used, replacement] as never), patchMenuPlan });

    expect(await svc(cms).swapDish(50, 1, 3, false, 2)).toEqual({ ok: false, error: "plan-published" });
    expect(await svc(cms).swapDish(50, 1, 3, true, 2)).toMatchObject({ ok: true });
    expect(patchMenuPlan).toHaveBeenCalledWith("jwt", 50, { offerings: [1, 2, 3], publishText: null });
  });

  it("revalidates a frozen automatic replacement against the current slot", async () => {
    const [target, replacement] = [component(1, "牛腩", "牛"), component(3, "鱼排", "鱼")];
    const getMenuPlan = vi.fn().mockResolvedValueOnce(planWith([target])).mockResolvedValueOnce(planWith([target, replacement]));
    const patchMenuPlan = vi.fn(async (_jwt, _id, patch) => ({ ...planWith([target]), ...patch }) as never);
    const service = svc(baseCms({ getMenuPlan, findOfferings: vi.fn(async () => [target, replacement] as never), patchMenuPlan }));
    expect(await service.swapDish(50, 1, 3, false, 0, true)).toMatchObject({ ok: true });
    expect(await service.swapDish(50, 1, 3, false, 0, true)).toEqual({ ok: false, error: "no-alternative" });
    expect(patchMenuPlan).toHaveBeenCalledOnce();
  });
});

describe("preview reads (operation-confirm cards, #126 rich previews)", () => {
  it("previewOrder: populated customer → display info; sums item quantities", async () => {
    const cms = baseCms({
      getOrder: vi.fn(async () => ({ id: 1, occasion: "dinner", customer: { id: 5, displayName: "王燕萍" }, items: [{ id: 201, quantity: 2 }, { id: 202, quantity: 1 }] }) as never),
    });
    expect(await svc(cms).previewOrder(1)).toEqual({ displayName: "王燕萍", quantity: 3, occasion: "dinner" });
  });

  it("previewOrder: null when getOrder throws", async () => {
    const cms = baseCms({ getOrder: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).previewOrder(1)).toBeNull();
  });

  it("previewMenuTargets: ok lines (dry-run, no upsert)", async () => {
    const cms = baseCms({
      findOfferings: vi.fn(async () => [
        { id: 1, kind: "component", category: "meat", name: "红烧牛肉", mainIngredient: "牛肉", active: true },
        { id: 2, kind: "component", category: "meat", name: "香菇滑鸡", mainIngredient: "鸡", active: true },
        { id: 3, kind: "component", category: "veg", name: "青菜", mainIngredient: "青菜", active: true },
        { id: 4, kind: "component", category: "veg", name: "豆腐", mainIngredient: "豆腐", active: true },
        { id: 5, kind: "component", category: "soup", name: "蛋花汤", mainIngredient: "蛋", active: true },
      ] as never),
    });
    const r = await svc(cms).previewMenuTargets([{ date: "2026-06-29", occasion: "lunch" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines[0]).toContain("午餐");
      expect(r.plannedItems).toHaveLength(1);
      expect(r.plannedItems[0]).toMatchObject({ date: "2026-06-29", occasion: "lunch" });
      expect(r.plannedItems[0]!.offerings).toHaveLength(5);
    }
    expect(cms.upsertMenuPlans).not.toHaveBeenCalled();
  });

  it("previewMenuTargets: pool-too-small when the pool can't fill the structure", async () => {
    const cms = baseCms({ findOfferings: vi.fn(async () => [{ id: 1, kind: "component", category: "meat", active: true }] as never) });
    expect(await svc(cms).previewMenuTargets([{ date: "2026-06-29", occasion: "lunch" }])).toMatchObject({ ok: false, reason: "pool-too-small" });
  });

  it("previewMenuTargets: plan-published blocks without force", async () => {
    const cms = baseCms({
      listMenuPlans: vi.fn(async () => [{ status: "published", slot: { date: "2026-06-29T00:00:00.000Z", occasion: "lunch" } }] as never),
    });
    expect(await svc(cms).previewMenuTargets([{ date: "2026-06-29", occasion: "lunch" }])).toMatchObject({ ok: false, reason: "plan-published" });
  });

  it("previewSwap: ok old→new names (dry-run, no patch); specified replacement", async () => {
    const cms = baseCms({
      getMenuPlan: vi.fn(async () => ({
        id: 50, status: "draft", slot: { date: "2026-06-29T00:00:00.000Z", occasion: "lunch" },
        offerings: [{ id: 12, name: "牛腩", category: "meat", mainIngredient: "牛肉" }],
      }) as never),
      findOfferings: vi.fn(async () => [
        { id: 12, kind: "component", name: "牛腩", category: "meat", mainIngredient: "牛肉", active: true },
        { id: 19, kind: "component", name: "香菇滑鸡", category: "meat", mainIngredient: "鸡", active: true },
      ] as never),
    });
    const r = await svc(cms).previewSwap(50, 12, 19);
    expect(r).toMatchObject({ ok: true, oldName: "牛腩", newName: "香菇滑鸡", replacementId: 19 });
    expect(cms.patchMenuPlan).not.toHaveBeenCalled();
  });

  it("previewSwap: automatic preview returns the fixed target and history explanation", async () => {
    const [target, used, replacement] = [component(1, "牛腩", "牛"), component(2, "白切鸡", "鸡"), component(3, "鱼排", "鱼")];
    const current = planWith([target, used]);
    const history = planWith([replacement], { id: 51, slot: { date: "2026-06-28", occasion: "dinner" } });
    const listMenuPlans = vi.fn(async () => [current, history] as never);
    const cms = baseCms({ getMenuPlan: vi.fn(async () => current as never), findOfferings: vi.fn(async () => [target, used, replacement] as never), listMenuPlans });

    expect(await svc(cms).previewSwap(50, 1, undefined)).toMatchObject({
      ok: true, replacementId: 3, targetIndex: 0,
      relaxedRules: ["recent-offering", "recent-main-ingredient"],
    });
    expect(listMenuPlans).toHaveBeenCalledWith("jwt", { from: "2026-06-22", to: "2026-07-05" });
    expect(cms.patchMenuPlan).not.toHaveBeenCalled();
  });

  it("previewSwap: rejects an invalid target before loading history", async () => {
    const current = planWith([component(1, "牛腩", "牛")]);
    const listMenuPlans = vi.fn(async () => { throw new Error("history unavailable"); });
    const cms = baseCms({ getMenuPlan: vi.fn(async () => current as never), listMenuPlans });
    expect(await svc(cms).previewSwap(50, 999, undefined)).toEqual({ ok: false, error: "dish-not-in-slot" });
    expect(listMenuPlans).not.toHaveBeenCalled();
  });

  it("previewSwap: plan-published blocks without force", async () => {
    const cms = baseCms({
      getMenuPlan: vi.fn(async () => ({ id: 50, status: "published", slot: { date: "2026-06-29", occasion: "lunch" }, offerings: [] }) as never),
    });
    expect(await svc(cms).previewSwap(50, 12, undefined)).toMatchObject({ ok: false, error: "plan-published" });
  });

  it("previewPublish: returns stored publishText as-is", async () => {
    const cms = baseCms({ getMenuPlan: vi.fn(async () => ({ id: 50, status: "published", slot: { date: "2026-06-29", occasion: "lunch" }, offerings: [], publishText: "已存文案" }) as never) });
    expect(await svc(cms).previewPublish(50)).toMatchObject({ ok: true, publishText: "已存文案" });
    expect(cms.getSeller).not.toHaveBeenCalled();
  });

  it("previewPublish: builds the jielong text when none stored", async () => {
    const cms = baseCms({
      getSeller: vi.fn(async () => ({ id: 1, name: "桃子", defaultPriceCents: 3000, status: "active" }) as never),
      getMenuPlan: vi.fn(async () => ({ id: 50, status: "draft", slot: { date: "2026-06-29T00:00:00.000Z", occasion: "lunch" }, offerings: [{ id: 1, name: "红烧牛肉" }, { id: 2, name: "青菜" }] }) as never),
    });
    const r = await svc(cms).previewPublish(50);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.publishText).toContain("红烧牛肉");
    expect(cms.patchMenuPlan).not.toHaveBeenCalled();
  });

  it("previewPublish: fails on cms error", async () => {
    const cms = baseCms({ getMenuPlan: vi.fn(async () => { throw new Error("net"); }) });
    expect(await svc(cms).previewPublish(50)).toMatchObject({ ok: false });
  });
});
