import type { Order } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi, type Mock } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import type { OrderDetail } from "../lib/cms/orders";
import type { OrderCms } from "../domain/orders/service";
import { orderRoutes, type OrderRoutesDeps } from "./orders";

const SECRET = "test-secret";
type CmsMocks = { [K in keyof OrderCms]: Mock<OrderCms[K]> };

const draftDetail: OrderDetail = {
  id: 90,
  date: "2026-06-30",
  status: "draft",
  customer: { id: 5, kind: "regular", address: "1D" },
  items: [{ id: 201, mealOccasion: "lunch", quantity: 1 }],
};

function mockCms(over: Partial<CmsMocks> = {}): CmsMocks {
  return {
    getSeller: over.getSeller ?? vi.fn<OrderCms["getSeller"]>(async () => ({ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" })),
    findOfferings: over.findOfferings ?? vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 1, name: "套餐", kind: "combo-meal", priceCents: 3000, seller: 7 }]),
    getOrder: over.getOrder ?? vi.fn<OrderCms["getOrder"]>(async () => draftDetail),
    createOrderDraft: over.createOrderDraft ?? vi.fn<OrderCms["createOrderDraft"]>(async () => ({ order: { id: 90, status: "draft" } as Order, items: [] })),
    updateOrder: over.updateOrder ?? vi.fn<OrderCms["updateOrder"]>(async () => ({ id: 90, status: "confirmed" } as Order)),
    upsertSlots: over.upsertSlots ?? vi.fn<OrderCms["upsertSlots"]>(async () => []),
    createFulfillments: over.createFulfillments ?? vi.fn<OrderCms["createFulfillments"]>(async () => []),
    setFulfillmentsByOrderItems: over.setFulfillmentsByOrderItems ?? vi.fn<OrderCms["setFulfillmentsByOrderItems"]>(async () => undefined),
  };
}

const token = async () => issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);
const auth = async () => ({ Authorization: `Bearer ${await token()}` });
const json = async () => ({ ...(await auth()), "content-type": "application/json" });
const deps = (cms: CmsMocks, listOrders?: OrderRoutesDeps["listOrders"]): OrderRoutesDeps => ({
  cms,
  listOrders: listOrders ?? vi.fn(async () => []),
});

describe("default deps wiring", () => {
  it("constructs the app with the real cms when deps are omitted (no cms call on a 401)", async () => {
    const app = orderRoutes(SECRET); // exercises realCms() default param
    expect((await app.request("/")).status).toBe(401);
  });
});

describe("GET /orders", () => {
  it("returns the seller's orders (passthrough to cms)", async () => {
    const listOrders = vi.fn<OrderRoutesDeps["listOrders"]>(async () => [{ id: 1, status: "confirmed" } as Order]);
    const app = orderRoutes(SECRET, deps(mockCms(), listOrders));
    const res = await app.request("/?date=2026-06-30", { headers: await auth() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { orders: unknown[] }).orders).toHaveLength(1);
    expect(listOrders.mock.calls[0]?.[1]).toMatchObject({ date: "2026-06-30" });
  });

  it("401 without a token", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    expect((await app.request("/")).status).toBe(401);
  });
});

describe("POST /orders", () => {
  const body = { customer: 5, date: "2026-06-30", source: "chat-paste", items: [{ offering: 1, mealOccasion: "lunch", quantity: 1 }] };

  it("records a draft (201) and returns the created order", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    expect(cms.createOrderDraft).toHaveBeenCalledOnce();
  });

  it("400 when required fields are missing", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ customer: 5 }) });
    expect(res.status).toBe(400);
  });

  it("502 when cms create throws", async () => {
    const cms = mockCms({ getSeller: vi.fn<OrderCms["getSeller"]>(async () => { throw new Error("cms down"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify(body) });
    expect(res.status).toBe(502);
  });

  it("400 when the body is not JSON", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    const res = await app.request("/", { method: "POST", headers: await auth(), body: "not-json" });
    expect(res.status).toBe(400);
  });
});

describe("POST /orders/:id/confirm", () => {
  it("materializes the draft (200)", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/confirm", { method: "POST", headers: await auth() });
    expect(res.status).toBe(200);
    expect(cms.updateOrder).toHaveBeenCalledWith(expect.any(String), "90", { status: "confirmed" });
  });

  it("409 when the order is not a draft", async () => {
    const notDraft: OrderDetail = { id: 90, date: "x", status: "confirmed", customer: { id: 1, kind: "regular" }, items: [] };
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => notDraft) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/confirm", { method: "POST", headers: await auth() });
    expect(res.status).toBe(409);
  });

  it("502 when confirm throws a non-state error", async () => {
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => { throw new Error("cms down"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/confirm", { method: "POST", headers: await auth() });
    expect(res.status).toBe(502);
  });
});

describe("POST /orders/:id/cancel", () => {
  it("cancels (200)", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/cancel", { method: "POST", headers: await auth() });
    expect(res.status).toBe(200);
    expect(cms.updateOrder).toHaveBeenCalledWith(expect.any(String), "90", { status: "canceled" });
  });

  it("502 when cancel throws", async () => {
    const cms = mockCms({ getOrder: vi.fn<OrderCms["getOrder"]>(async () => { throw new Error("cms down"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/cancel", { method: "POST", headers: await auth() });
    expect(res.status).toBe(502);
  });
});

describe("PATCH /orders/:id", () => {
  it("updates payment/date/note and strips status", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90", { method: "PATCH", headers: await json(), body: JSON.stringify({ status: "confirmed", paymentStatus: "paid" }) });
    expect(res.status).toBe(200);
    expect(cms.updateOrder).toHaveBeenCalledWith(expect.any(String), "90", { paymentStatus: "paid" });
  });

  it("400 when no updatable fields remain", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    const res = await app.request("/90", { method: "PATCH", headers: await json(), body: JSON.stringify({ status: "confirmed" }) });
    expect(res.status).toBe(400);
  });

  it("502 when cms update throws", async () => {
    const cms = mockCms({ updateOrder: vi.fn<OrderCms["updateOrder"]>(async () => { throw new Error("cms down"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90", { method: "PATCH", headers: await json(), body: JSON.stringify({ paymentStatus: "paid" }) });
    expect(res.status).toBe(502);
  });

  it("400 when the body is not JSON", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    const res = await app.request("/90", { method: "PATCH", headers: await auth(), body: "not-json" });
    expect(res.status).toBe(400);
  });
});
