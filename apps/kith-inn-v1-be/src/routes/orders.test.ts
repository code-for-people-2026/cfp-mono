import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CmsCustomerProfile,
  CmsOrderCreate,
  CustomerProfileCreate,
  MealSlot,
  ManualOrderUpdate,
  Order,
  SellerSnapshot
} from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsCustomerProfileError } from "../lib/cms/customerProfiles";
import { CmsMealSlotError } from "../lib/cms/mealSlots";
import { CmsOrderError } from "../lib/cms/orders";
import { CmsSellerError } from "../lib/cms/seller";
import {
  customerProfilesRoutes,
  ordersRoutes,
  type OrdersDeps
} from "./orders";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const seller: SellerSnapshot = {
  id: 7,
  name: "桃子",
  defaultPriceCents: 3000,
  status: "active"
};
const profile: CmsCustomerProfile = {
  id: 21,
  sellerId: 7,
  openid: null,
  displayName: "王阿姨",
  address: "3A-1201",
  active: true
};
const slot: MealSlot = {
  id: 11,
  sellerId: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems: [
    { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
    { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
    { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
    { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
    { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
  ],
  orderStatus: "draft",
  priceCents: null,
  generatedAt: "2026-07-10T01:00:00.000Z"
};
const order: Order = {
  id: 31,
  sellerId: 7,
  mealSlotId: 11,
  customerProfileId: 21,
  status: "draft",
  source: "manual",
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 3000,
  totalCents: 6000,
  paymentStatus: "unpaid",
  paidAt: null,
  deliveryStatus: "pending",
  deliveredAt: null,
  confirmedAt: null,
  canceledAt: null,
  note: null
};

function deps(overrides: Partial<OrdersDeps> = {}): OrdersDeps {
  return {
    getSeller: vi.fn(async () => seller),
    listMealSlots: vi.fn(async () => [slot]),
    getMealSlot: vi.fn(async () => slot),
    listCustomerProfiles: vi.fn(async () => [profile]),
    createCustomerProfile: vi.fn(async (_token: string, input: CustomerProfileCreate) => ({
      ...profile,
      id: 22,
      ...input
    })),
    listOrders: vi.fn(async () => [order]),
    getOrder: vi.fn(async () => order),
    createOrder: vi.fn(async (_token: string, input: CmsOrderCreate) => ({
      id: 32,
      sellerId: 7,
      totalCents: input.quantity * input.unitPriceCents,
      ...input
    })),
    updateOrder: vi.fn(async (_token: string, _id: string | number, input: ManualOrderUpdate) => ({
      ...order,
      ...input,
      totalCents: (input.quantity ?? order.quantity) * order.unitPriceCents
    })),
    ...overrides
  };
}

function request(app: ReturnType<typeof ordersRoutes> | ReturnType<typeof customerProfilesRoutes>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
}

describe("merchant customer-profile routes", () => {
  it("lists and creates public profiles without exposing openid", async () => {
    const routeDeps = deps();
    const app = customerProfilesRoutes(SECRET, routeDeps);
    const listed = await request(app, "/?query=%E7%8E%8B+%E9%98%BF%E5%A7%A8");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ docs: [{
      id: 21,
      sellerId: 7,
      displayName: "王阿姨",
      address: "3A-1201",
      active: true
    }] });
    expect(routeDeps.listCustomerProfiles).toHaveBeenCalledWith(token, "王 阿姨");

    const created = await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ displayName: "李叔", address: "2B-901" })
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({ doc: { displayName: "李叔", address: "2B-901" } });
    expect(JSON.stringify(createdBody).includes("openid")).toBe(false);
  });

  it("rejects malformed input and maps profile dependency failures", async () => {
    const app = customerProfilesRoutes(SECRET, deps());
    expect((await request(app, "/?query=" + "x".repeat(241))).status).toBe(400);
    expect((await request(app, "/", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ displayName: "王阿姨", address: "3A", openid: "leak" })
    })).status).toBe(422);

    for (const status of [401, 403, 404, 409, 422, 500]) {
      const failed = customerProfilesRoutes(SECRET, deps({
        listCustomerProfiles: vi.fn(async () => {
          throw new CmsCustomerProfileError(status, `profile-${status}`, "失败");
        })
      }));
      expect((await request(failed, "/")).status).toBe(status === 500 ? 502 : status);
    }
    const createFailed = customerProfilesRoutes(SECRET, deps({
      createCustomerProfile: vi.fn(async () => {
        throw new CmsCustomerProfileError(409, "profile-conflict", "冲突");
      })
    }));
    expect((await request(createFailed, "/", {
      method: "POST",
      body: JSON.stringify({ displayName: "王阿姨", address: "3A" })
    })).status).toBe(409);
  });
});

describe("merchant draft-order routes", () => {
  it("lists the selected meal slot with confirmed-only summary", async () => {
    const confirmed = {
      ...order,
      id: 33,
      status: "confirmed" as const,
      quantity: 3,
      totalCents: 9000,
      confirmedAt: "2026-07-10T01:00:00.000Z"
    };
    const app = ordersRoutes(SECRET, deps({ listOrders: vi.fn(async () => [order, confirmed]) }));
    const response = await request(app, "/?date=2026-07-13&occasion=lunch");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mealSlot: slot,
      docs: [order, confirmed],
      summary: { confirmedOrders: 1, totalQuantity: 3, unpaid: 1, pendingDelivery: 1 }
    });
  });

  it("creates a draft from an existing profile with the seller price fallback", async () => {
    const routeDeps = deps();
    const app = ordersRoutes(SECRET, routeDeps);
    const response = await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 2, note: "少辣" })
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      doc: { id: 32, customerProfileId: 21, unitPriceCents: 3000, totalCents: 6000 },
      profile: { id: 21, displayName: "王阿姨" }
    });
    expect(routeDeps.createOrder).toHaveBeenCalledWith(token, expect.objectContaining({
      mealSlotId: 11,
      customerProfileId: 21,
      customerOpenid: null,
      status: "draft",
      source: "manual",
      displayName: "王阿姨",
      address: "3A-1201",
      unitPriceCents: 3000
    }));
  });

  it("creates the profile first and prefers a meal-slot price", async () => {
    const routeDeps = deps({
      getMealSlot: vi.fn(async () => ({ ...slot, priceCents: 2500 }))
    });
    const app = ordersRoutes(SECRET, routeDeps);
    const response = await request(app, "/", {
      method: "POST",
      body: JSON.stringify({
        mealSlotId: 11,
        newProfile: { displayName: "李叔", address: "2B-901" },
        quantity: 1
      })
    });
    expect(response.status).toBe(201);
    expect(routeDeps.createCustomerProfile).toHaveBeenCalledWith(token, { displayName: "李叔", address: "2B-901" });
    expect(routeDeps.createOrder).toHaveBeenCalledWith(token, expect.objectContaining({
      customerProfileId: 22,
      unitPriceCents: 2500
    }));
  });

  it("returns a minimal duplicate summary for draft, confirmed and canceled orders", async () => {
    for (const status of ["draft", "confirmed", "canceled"] as const) {
      const existing = { ...order, status };
      const routeDeps = deps({
        listOrders: vi.fn(async () => [existing]),
        createOrder: vi.fn(async () => {
          throw new CmsOrderError(409, "order-conflict", "冲突");
        })
      });
      const response = await request(ordersRoutes(SECRET, routeDeps), "/", {
        method: "POST",
        body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 3 })
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: status === "canceled" ? "canceled-order-exists" : "order-exists",
        message: status === "canceled" ? "已取消订单需要明确重提" : "订单已存在，请确认更新",
        existing: { id: 31, status, quantity: 2 }
      });
    }
  });

  it("edits only draft snapshots and rejects non-draft orders", async () => {
    const routeDeps = deps();
    const app = ordersRoutes(SECRET, routeDeps);
    const response = await request(app, "/31", {
      method: "PATCH",
      body: JSON.stringify({ quantity: 3, address: "3A-1202", note: "门口放" })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ doc: { id: 31, quantity: 3, totalCents: 9000 } });
    expect(routeDeps.updateOrder).toHaveBeenCalledWith(token, "31", {
      quantity: 3,
      address: "3A-1202",
      note: "门口放"
    });

    for (const status of ["confirmed", "canceled"] as const) {
      const blocked = ordersRoutes(SECRET, deps({ getOrder: vi.fn(async () => ({ ...order, status })) }));
      expect((await request(blocked, "/31", {
        method: "PATCH",
        body: JSON.stringify({ quantity: 4 })
      })).status).toBe(409);
    }
  });

  it("rejects invalid selectors, profile ids, injected fields and malformed JSON", async () => {
    const app = ordersRoutes(SECRET, deps());
    expect((await request(app, "/?date=bad&occasion=lunch")).status).toBe(400);
    expect((await request(app, "/", { method: "POST", body: "{" })).status).toBe(400);
    expect((await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 1, seller: 99 })
    })).status).toBe(422);
    expect((await request(app, "/31", { method: "PATCH", body: JSON.stringify({ status: "confirmed" }) })).status).toBe(422);
    expect((await request(app, "/31", { method: "PATCH", body: "{" })).status).toBe(400);

    const missingSlot = ordersRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => []) }));
    expect((await request(missingSlot, "/?date=2026-07-13&occasion=lunch")).status).toBe(404);
    const missingProfile = ordersRoutes(SECRET, deps({ listCustomerProfiles: vi.fn(async () => []) }));
    expect((await request(missingProfile, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotId: 11, customerProfileId: 99, quantity: 1 })
    })).status).toBe(404);
  });

  it("preserves actionable dependency statuses and hides unknown failures", async () => {
    const failures = [
      new CmsSellerError(403, "membership-inactive", "停用"),
      new CmsMealSlotError(404, "not-found", "不存在"),
      new CmsCustomerProfileError(422, "profile-invalid", "资料无效"),
      new CmsOrderError(409, "order-conflict", "冲突")
    ];
    for (const error of failures) {
      const app = ordersRoutes(SECRET, deps({
        getMealSlot: vi.fn(async () => { throw error; })
      }));
      const response = await request(app, "/", {
        method: "POST",
        body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 1 })
      });
      expect(response.status).toBe(error.status);
    }
    const offline = ordersRoutes(SECRET, deps({ listMealSlots: vi.fn(async () => { throw new Error("offline"); }) }));
    expect((await request(offline, "/?date=2026-07-13&occasion=lunch")).status).toBe(502);

    const patchMissing = ordersRoutes(SECRET, deps({
      getOrder: vi.fn(async () => { throw new CmsOrderError(404, "not-found", "不存在"); })
    }));
    expect((await request(patchMissing, "/31", {
      method: "PATCH",
      body: JSON.stringify({ quantity: 3 })
    })).status).toBe(404);

    const createFailed = ordersRoutes(SECRET, deps({
      createOrder: vi.fn(async () => { throw new CmsOrderError(500, "write-failed", "失败"); })
    }));
    expect((await request(createFailed, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 1 })
    })).status).toBe(502);

    const racedWithoutVisibleOrder = ordersRoutes(SECRET, deps({
      createOrder: vi.fn(async () => { throw new CmsOrderError(409, "order-conflict", "冲突"); }),
      listOrders: vi.fn(async () => [])
    }));
    expect((await request(racedWithoutVisibleOrder, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 1 })
    })).status).toBe(409);
  });

  it("wires every real CMS dependency by default", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/seller")) return new Response(JSON.stringify({ doc: seller }));
      if (url.includes("/customer-profiles")) {
        return new Response(JSON.stringify(method === "POST" ? { doc: profile } : { docs: [profile] }), {
          status: method === "POST" ? 201 : 200
        });
      }
      if (url.includes("/meal-slots?")) return new Response(JSON.stringify({ docs: [slot] }));
      if (url.endsWith("/meal-slots/11")) return new Response(JSON.stringify({ doc: slot }));
      if (url.includes("/orders?")) return new Response(JSON.stringify({ docs: [order] }));
      if (url.endsWith("/orders/31")) return new Response(JSON.stringify({ doc: order }));
      if (url.endsWith("/orders") && method === "POST") {
        return new Response(JSON.stringify({ doc: order }), { status: 201 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const profilesApp = customerProfilesRoutes(SECRET);
    expect((await request(profilesApp, "/")).status).toBe(200);
    expect((await request(profilesApp, "/", {
      method: "POST",
      body: JSON.stringify({ displayName: "王阿姨", address: "3A" })
    })).status).toBe(201);

    const app = ordersRoutes(SECRET);
    expect((await request(app, "/?date=2026-07-13&occasion=lunch")).status).toBe(200);
    expect((await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ mealSlotId: 11, customerProfileId: 21, quantity: 1 })
    })).status).toBe(201);
    expect((await request(app, "/31", {
      method: "PATCH",
      body: JSON.stringify({ quantity: 3 })
    })).status).toBe(200);
    expect(fetch).toHaveBeenCalled();
  });
});
