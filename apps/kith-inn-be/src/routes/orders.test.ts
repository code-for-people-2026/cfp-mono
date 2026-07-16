import type { Order } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi, type Mock } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { CmsHttpError, type OrderDetail } from "../lib/cms/orders";
import type { OrderCms } from "../domain/orders/service";
import { orderRoutes, type OrderRoutesDeps } from "./orders";

const SECRET = "test-secret";
type CmsMocks = { [K in keyof OrderCms]: Mock<OrderCms[K]> };

const draftDetail: OrderDetail = {
  id: 90,
  date: "2026-06-30",
  occasion: "lunch",
  status: "draft",
  customer: { id: 5, address: "1D" },
  items: [{ id: 201, quantity: 1 }],
};

function mockCms(over: Partial<CmsMocks> = {}): CmsMocks {
  return {
    getSeller: over.getSeller ?? vi.fn<OrderCms["getSeller"]>(async () => ({ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" })),
    findOfferings: over.findOfferings ?? vi.fn<OrderCms["findOfferings"]>(async () => [{ id: 1, name: "套餐", kind: "combo-meal", priceCents: 3000, seller: 7 }]),
    getOrder: over.getOrder ?? vi.fn<OrderCms["getOrder"]>(async () => draftDetail),
    createOrderDraft: over.createOrderDraft ?? vi.fn<OrderCms["createOrderDraft"]>(async () => ({ order: { id: 90, occasion: "lunch", status: "draft" } as Order, items: [] })),
    confirmOrderAtomic: over.confirmOrderAtomic ?? vi.fn<OrderCms["confirmOrderAtomic"]>(async () => ({ slots: [], fulfillments: [] })),
    cancelOrderAtomic: over.cancelOrderAtomic ?? vi.fn<OrderCms["cancelOrderAtomic"]>(async () => undefined),
    updateOrder: over.updateOrder ?? vi.fn<OrderCms["updateOrder"]>(async () => ({ id: 90, status: "confirmed" } as Order)),
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
  const body = { customer: 5, date: "2026-06-30", occasion: "lunch", source: "chat-paste", items: [{ offering: 1, quantity: 1 }] };

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

  it("400 when items is empty", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    const res = await app.request("/", { method: "POST", headers: await json(), body: JSON.stringify({ ...body, items: [] }) });
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
    expect(cms.confirmOrderAtomic).toHaveBeenCalledWith(expect.any(String), "90");
  });

  it("409 when the order is not a draft", async () => {
    const cms = mockCms({ confirmOrderAtomic: vi.fn<OrderCms["confirmOrderAtomic"]>(async () => { throw new CmsHttpError(409, "confirm", "not-draft"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/confirm", { method: "POST", headers: await auth() });
    expect(res.status).toBe(409);
  });

  it("409 when a draft has no items", async () => {
    const cms = mockCms({ confirmOrderAtomic: vi.fn<OrderCms["confirmOrderAtomic"]>(async () => { throw new CmsHttpError(409, "confirm", "empty-order"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/confirm", { method: "POST", headers: await auth() });
    expect(res.status).toBe(409);
    expect(cms.confirmOrderAtomic).toHaveBeenCalledOnce();
  });

  it("502 when confirm throws a non-state error", async () => {
    const cms = mockCms({ confirmOrderAtomic: vi.fn<OrderCms["confirmOrderAtomic"]>(async () => { throw new Error("cms down"); }) });
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
    expect(cms.cancelOrderAtomic).toHaveBeenCalledWith(expect.any(String), "90");
  });

  it("502 when cancel throws", async () => {
    const cms = mockCms({ cancelOrderAtomic: vi.fn<OrderCms["cancelOrderAtomic"]>(async () => { throw new Error("cms down"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90/cancel", { method: "POST", headers: await auth() });
    expect(res.status).toBe(502);
  });
});

describe("PATCH /orders/:id", () => {
  it("passes every ordinary field and strips forbidden fields from a mixed body", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const patch = {
      paymentStatus: "paid",
      paymentMethod: "wechat",
      paidAt: "2026-07-13T08:00:00.000Z",
      date: "2026-07-14",
      occasion: "dinner",
      note: "放门口",
    };
    const res = await app.request("/90", {
      method: "PATCH",
      headers: await json(),
      body: JSON.stringify({
        ...patch,
        address: "9Z-999",
        status: "confirmed",
        customer: 99,
        seller: 99,
        unknown: "forged",
      }),
    });
    expect(res.status).toBe(200);
    expect(cms.updateOrder).toHaveBeenCalledWith(expect.any(String), "90", patch);
  });

  it("400 when only forbidden or unknown fields remain", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90", {
      method: "PATCH",
      headers: await json(),
      body: JSON.stringify({ address: "9Z-999", status: "confirmed", customer: 99, seller: 99, unknown: "forged" }),
    });
    expect(res.status).toBe(400);
    expect(cms.updateOrder).not.toHaveBeenCalled();
  });

  it("rejects reconciled and other non-user payment states", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90", {
      method: "PATCH",
      headers: await json(),
      body: JSON.stringify({ paymentStatus: "reconciled" }),
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "paymentStatus must be unpaid or paid" });
    expect(cms.updateOrder).not.toHaveBeenCalled();
  });

  it("timestamps a paid mark and clears the whole record when it is revoked", async () => {
    const cms = mockCms();
    const app = orderRoutes(SECRET, deps(cms));

    expect((await app.request("/90", {
      method: "PATCH",
      headers: await json(),
      body: JSON.stringify({ paymentStatus: "paid" }),
    })).status).toBe(200);
    expect(cms.updateOrder).toHaveBeenLastCalledWith(expect.any(String), "90", {
      paymentStatus: "paid",
      paidAt: expect.any(String),
    });

    expect((await app.request("/90", {
      method: "PATCH",
      headers: await json(),
      body: JSON.stringify({ paymentStatus: "unpaid", paidAt: "stale", paymentMethod: "wechat" }),
    })).status).toBe(200);
    expect(cms.updateOrder).toHaveBeenLastCalledWith(expect.any(String), "90", {
      paymentStatus: "unpaid",
      paidAt: null,
      paymentMethod: null,
    });
  });

  it("502 when cms update throws", async () => {
    const cms = mockCms({ updateOrder: vi.fn<OrderCms["updateOrder"]>(async () => { throw new Error("cms down"); }) });
    const app = orderRoutes(SECRET, deps(cms));
    const res = await app.request("/90", { method: "PATCH", headers: await json(), body: JSON.stringify({ note: "少辣" }) });
    expect(res.status).toBe(502);
  });

  it("400 when the body is not JSON", async () => {
    const app = orderRoutes(SECRET, deps(mockCms()));
    const res = await app.request("/90", { method: "PATCH", headers: await auth(), body: "not-json" });
    expect(res.status).toBe(400);
  });
});
