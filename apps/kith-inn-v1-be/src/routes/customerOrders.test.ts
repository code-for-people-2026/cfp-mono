import { describe, expect, it, vi } from "vitest";
import type { CustomerOrderView, CustomerProfile, CustomerReservationInput, CustomerReservationResponse } from "@cfp/kith-inn-v1-shared";
import { issueCustomerToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CustomerReservationError } from "../domain/customerOrders/service";
import { CmsBookingBatchError } from "../lib/cms/bookingBatches";
import { CmsCustomerProfileError } from "../lib/cms/customerProfiles";
import { CmsOrderError } from "../lib/cms/orders";
import { customerOrderManagementRoutes, customerOrderRoutes, type CustomerOrderManagementRouteDeps,
  type CustomerOrderRouteDeps } from "./customerOrders";

const SECRET = "v1-secret";
const token = await issueCustomerToken({ sellerId: 7, openid: "wx-customer" }, SECRET);
const operatorToken = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const batchPublicId = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
const target = (day: number, occasion: "lunch" | "dinner" = "lunch") => ({
  date: `2026-07-${String(day).padStart(2, "0")}`, occasion
});
const profile = {
  id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: true
} satisfies CustomerProfile;
const order = {
  id: 31, sellerId: 7, mealSlotId: 11, customerProfileId: 21, status: "draft" as const,
  source: "customer-card" as const, displayName: "王阿姨", address: "3A", quantity: 2,
  unitPriceCents: 3000, totalCents: 6000, paymentStatus: "unpaid" as const, paidAt: null,
  deliveryStatus: "pending" as const, deliveredAt: null, confirmedAt: null, canceledAt: null, note: null
};
const result: CustomerReservationResponse = {
  profile,
  results: [
    { target: target(13), status: "created", doc: order },
    { target: target(14), status: "failed", error: "meal-slot-closed", message: "餐次已关闭登记" },
    { target: target(15), status: "failed", error: "database-detail", message: "secret" }
  ]
};
const orderView: CustomerOrderView = {
  id: 31, target: target(13), menuItems: Array.from({ length: 5 }, (_, index) => ({ nameSnapshot: `菜${index + 1}`,
    mainIngredientSnapshot: null, categorySnapshot: index < 2 ? "meat" : index < 4 ? "veg" : "soup" })),
  orderStatus: "open", orderDeadline: "2026-07-12T01:00:00.000Z", displayName: "王阿姨", address: "3A",
  quantity: 2, unitPriceCents: 3000, totalCents: 6000, status: "draft", paymentStatus: "unpaid", paidAt: null,
  deliveryStatus: "pending", deliveredAt: null, confirmedAt: null, canceledAt: null
};
const input = (items: unknown = [{ target: target(13), quantity: 2 }]) => ({
  batchPublicId, profile: { customerProfileId: 21 }, displayName: "王阿姨", address: "3A", items
});

function deps(overrides: Partial<CustomerOrderRouteDeps> = {}): CustomerOrderRouteDeps {
  return { submit: vi.fn(async () => result), ...overrides };
}
function managementDeps(overrides: Partial<CustomerOrderManagementRouteDeps> = {}): CustomerOrderManagementRouteDeps {
  return { list: vi.fn(async () => [orderView]), edit: vi.fn(async () => ({ ...orderView, quantity: 3, totalCents: 9000 })),
    cancel: vi.fn(async () => ({ ...orderView, status: "canceled" as const, canceledAt: "2026-07-11T00:00:00.000Z" })),
    ...overrides };
}
function request(app: ReturnType<typeof customerOrderRoutes>, body: string, bearer = token) {
  return app.request("/", {
    method: "POST", headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body
  });
}

describe("customer reservation route", () => {
  it("normalizes exact duplicates and returns partial results as HTTP 200", async () => {
    const injected = deps();
    const app = customerOrderRoutes(SECRET, injected);
    const response = await request(app, JSON.stringify(input([
      { target: target(13), quantity: 2 }, { target: target(13), quantity: 2, resubmitCanceled: false }
    ])));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...result, results: [
      result.results[0], result.results[1],
      { target: target(15), status: "failed", error: "reservation-item-failed", message: "登记失败" }
    ] });
    expect(injected.submit).toHaveBeenCalledWith(token, "wx-customer", expect.objectContaining({
      items: [{ target: target(13), quantity: 2, resubmitCanceled: false }]
    }));
    expect((await request(app, JSON.stringify(input(
      Array.from({ length: 20 }, (_, index) => ({ target: target(index + 1), quantity: 1 }))
    )))).status).toBe(200);
    expect((await request(app, JSON.stringify(input()), operatorToken)).status).toBe(401);
    expect((await app.request("/", { method: "POST" })).status).toBe(401);
  });

  it("rejects malformed, conflicting, excessive and owner-injected requests before writes", async () => {
    const injected = deps();
    const app = customerOrderRoutes(SECRET, injected);
    expect((await request(app, "{")).status).toBe(400);
    for (const value of [
      input([{ target: target(13), quantity: 1 }, { target: target(13), quantity: 2 }]),
      input(Array.from({ length: 21 }, (_, index) => ({ target: target(index + 1), quantity: 1 }))),
      input([{ target: target(13), mealSlotId: 11, quantity: 1 }]),
      { ...input(), sellerId: 7, openid: "leak", source: "customer-card", status: "draft" }
    ]) expect((await request(app, JSON.stringify(value))).status).toBe(422);
    expect(injected.submit).not.toHaveBeenCalled();
  });

  it("maps whole-request domain/CMS errors and sanitizes unknown failures", async () => {
    for (const [error, status, code] of [
      [new CustomerReservationError(404, "customer-profile-not-found", "不存在"), 404, "customer-profile-not-found"],
      [new CmsCustomerProfileError(422, "profile-invalid", "无效"), 422, "profile-invalid"],
      [new CmsCustomerProfileError(500, "database-detail", "secret"), 502, "cms-unavailable"],
      [new Error("secret"), 502, "cms-unavailable"]
    ] as const) {
      const app = customerOrderRoutes(SECRET, deps({
        submit: vi.fn(async (_token: string, _openid: string, _input: CustomerReservationInput) => { throw error; })
      }));
      const response = await request(app, JSON.stringify(input()));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: code });
    }
  });
});

describe("customer order management routes", () => {
  const call = (app: ReturnType<typeof customerOrderManagementRoutes>, path: string, init: RequestInit = {}) => app.request(path, {
    ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
  it("lists, edits and explicitly cancels own orders", async () => {
    const injected = managementDeps();
    const app = customerOrderManagementRoutes(SECRET, injected);
    expect((await call(app, "/")).status).toBe(200);
    expect((await call(app, "/31", { method: "PATCH", body: JSON.stringify({ batchPublicId, quantity: 3 }) })).status).toBe(200);
    expect((await call(app, "/31/cancel", { method: "POST", body: JSON.stringify({ batchPublicId, confirmed: true }) })).status).toBe(200);
    expect(injected.edit).toHaveBeenCalledWith(token, "31", { batchPublicId, quantity: 3 });
    expect(injected.cancel).toHaveBeenCalledWith(token, "31", { batchPublicId, confirmed: true });
    expect((await call(app, "/", { headers: { Authorization: `Bearer ${operatorToken}` } })).status).toBe(401);
  });
  it("rejects invalid writes and maps safe management errors", async () => {
    const app = customerOrderManagementRoutes(SECRET, managementDeps());
    expect((await call(app, "/31", { method: "PATCH", body: "{" })).status).toBe(400);
    expect((await call(app, "/31/cancel", { method: "POST", body: "{" })).status).toBe(400);
    expect((await call(app, "/31", { method: "PATCH", body: JSON.stringify({ batchPublicId, quantity: 2, status: "confirmed" }) })).status).toBe(422);
    expect((await call(app, "/31/cancel", { method: "POST", body: JSON.stringify({ batchPublicId, confirmed: false }) })).status).toBe(422);
    const locked = customerOrderManagementRoutes(SECRET, managementDeps({
      edit: vi.fn(async () => { throw new CustomerReservationError(409, "confirmed-order-locked", "商家已确认"); })
    }));
    await expect((await call(locked, "/31", { method: "PATCH", body: JSON.stringify({ batchPublicId, quantity: 2 }) })).json())
      .resolves.toMatchObject({ error: "confirmed-order-locked" });
    const missingBatch = customerOrderManagementRoutes(SECRET, managementDeps({
      edit: vi.fn(async () => { throw new CmsBookingBatchError(404, "booking-batch-not-found", "不存在"); })
    }));
    expect((await call(missingBatch, "/31", { method: "PATCH", body: JSON.stringify({ batchPublicId, quantity: 2 }) })).status)
      .toBe(404);
    for (const [error, status, code] of [
      [new CmsOrderError(409, "relationship-owner-mismatch", "internal"), 404, "order-not-found"],
      [new CmsOrderError(404, "customer-order-not-found", "internal"), 404, "order-not-found"],
      [new CmsOrderError(409, "meal-slot-closed", "餐次关闭"), 409, "meal-slot-closed"],
      [new CmsOrderError(422, "invalid-customer-order-update", "internal"), 502, "cms-unavailable"]
    ] as const) {
      const hidden = customerOrderManagementRoutes(SECRET, managementDeps({ edit: vi.fn(async () => { throw error; }) }));
      const response = await call(hidden, "/31", { method: "PATCH", body: JSON.stringify({ batchPublicId, quantity: 2 }) });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: code });
    }
  });
});
