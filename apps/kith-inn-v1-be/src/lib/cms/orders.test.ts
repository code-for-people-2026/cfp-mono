import { afterEach, describe, expect, it, vi } from "vitest";
import type { CmsOrderCreate, CmsOrderUpdate } from "@cfp/kith-inn-v1-shared";
import {
  CmsOrderError,
  createCustomerOrder,
  createOrder,
  findCustomerOrderBySlot,
  getOrder,
  listOrders,
  updateCustomerOrder,
  updateOrder
} from "./orders";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const order = {
  id: 31,
  sellerId: 7,
  mealSlotId: 11,
  customerProfileId: 21,
  status: "draft" as const,
  source: "manual" as const,
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 3000,
  totalCents: 6000,
  paymentStatus: "unpaid" as const,
  paidAt: null,
  deliveryStatus: "pending" as const,
  deliveredAt: null,
  confirmedAt: null,
  canceledAt: null,
  note: null
};
const createInput: CmsOrderCreate = {
  mealSlotId: 11,
  customerProfileId: 21,
  customerOpenid: null,
  status: "draft",
  source: "manual",
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 3000,
  paymentStatus: "unpaid",
  paidAt: null,
  deliveryStatus: "pending",
  deliveredAt: null,
  confirmedAt: null,
  canceledAt: null,
  note: null
};
const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS order client", () => {
  it("finds, creates and patches orders through the customer owner boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const customerOrder = { ...order, source: "customer-card" as const };
    const findDeps = response({ doc: customerOrder });
    await expect(findCustomerOrderBySlot("customer", 11, 21, findDeps)).resolves.toEqual(customerOrder);
    expect(findDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/customer/orders/by-slot/11?customerProfileId=21",
      { headers: { "x-kith-inn-v1-customer": "customer" } }
    );
    await expect(findCustomerOrderBySlot("customer", 11, 21, response({ doc: null }))).resolves.toBeNull();
    const customerCreate = { ...createInput, customerOpenid: "wx", source: "customer-card" as const, note: null };
    const createDeps = response({ doc: customerOrder }, 201);
    await expect(createCustomerOrder("customer", customerCreate, createDeps)).resolves.toEqual(customerOrder);
    const updateDeps = response({ doc: { ...customerOrder, quantity: 3, totalCents: 9000 } });
    await expect(updateCustomerOrder("customer", 31, { quantity: 3 }, updateDeps)).resolves.toMatchObject({ quantity: 3 });
    for (const deps of [createDeps, updateDeps]) {
      expect(deps.fetch).toHaveBeenCalledWith(expect.stringContaining("/customer/orders"), expect.objectContaining({
        headers: expect.objectContaining({
          "x-kith-inn-v1-customer": "customer", "x-kith-inn-v1-internal": "internal"
        })
      }));
    }
    await expect(findCustomerOrderBySlot("customer", 11, 21, response({ doc: {} })))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("lists, gets, creates and patches through the operator boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const listDeps = response({ docs: [order] });
    await expect(listOrders("jwt", 11, listDeps)).resolves.toEqual([order]);
    expect(listDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/orders?mealSlotId=11",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );

    await expect(getOrder("jwt", 31, response({ doc: order }))).resolves.toEqual(order);
    await expect(createOrder("jwt", createInput, response({ doc: order }, 201))).resolves.toEqual(order);
    const patch: CmsOrderUpdate = { quantity: 3, note: "门口放" };
    const updateDeps = response({ doc: { ...order, quantity: 3, totalCents: 9000, note: "门口放" } });
    await expect(updateOrder("jwt", 31, patch, updateDeps)).resolves.toMatchObject({ quantity: 3, totalCents: 9000 });
    expect(updateDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/orders/31",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "x-kith-inn-v1-internal": "internal" }),
        body: JSON.stringify(patch)
      })
    );

    const lifecycle: CmsOrderUpdate = {
      status: "confirmed",
      confirmedAt: "2026-07-11T00:00:00.000Z",
      canceledAt: null
    };
    const lifecycleDeps = response({ doc: { ...order, ...lifecycle } });
    await expect(updateOrder("jwt", 31, lifecycle, lifecycleDeps)).resolves.toMatchObject(lifecycle);
    expect(lifecycleDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/orders/31",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "x-kith-inn-v1-internal": "internal" }),
        body: JSON.stringify(lifecycle)
      })
    );
  });

  it("preserves errors and rejects malformed success envelopes", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    for (const status of [401, 403, 404, 409, 422, 500]) {
      await expect(getOrder("jwt", 31, response({ error: `error-${status}`, message: "失败" }, status)))
        .rejects.toMatchObject({ status, code: `error-${status}`, message: "失败" });
    }
    await expect(getOrder("jwt", 31, response({ error: "not-found" }, 404)))
      .rejects.toMatchObject({ status: 404, code: "not-found", message: "订单服务失败" });
    await expect(getOrder("jwt", 31, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(listOrders("jwt", 11, response({ docs: [{}] })))
      .rejects.toMatchObject({ status: 502, code: "invalid-cms-response" });
    await expect(listOrders("jwt", 11, response(null))).rejects.toBeInstanceOf(CmsOrderError);
    await expect(createOrder("jwt", createInput, response({}))).rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createOrder("jwt", createInput, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(updateOrder("jwt", 31, { quantity: 3 }, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("uses global fetch, stable fallbacks and fails without CMS_BASE_URL", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    vi.stubGlobal("fetch", response({ docs: [] }).fetch);
    await expect(listOrders("jwt", 11)).resolves.toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 500 })));
    await expect(listOrders("jwt", 11)).rejects.toMatchObject({ code: "cms-order-failed" });
    delete process.env.CMS_BASE_URL;
    await expect(listOrders("jwt", 11)).rejects.toThrow(/CMS_BASE_URL/);
  });
});
