import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(), createLocalReq: vi.fn(), initTransaction: vi.fn(),
  commitTransaction: vi.fn(), killTransaction: vi.fn()
}));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload,
  createLocalReq: mocks.createLocalReq,
  initTransaction: mocks.initTransaction,
  commitTransaction: mocks.commitTransaction,
  killTransaction: mocks.killTransaction
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { GET as getSeller } from "../src/app/api/internal/kiv1/seller/route";
import * as profileRoutes from "../src/app/api/internal/kiv1/customer-profiles/route";
import { GET as listOrders, POST as createOrder } from "../src/app/api/internal/kiv1/orders/route";
import * as orderRoute from "../src/app/api/internal/kiv1/orders/[id]/route";

const SECRET = "v1-secret";
const INTERNAL = "v1-internal";
const originalEnv = { ...process.env };
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const sellerDoc = { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" };
const slotDoc = { id: 11, seller: 7, date: "2026-07-13", occasion: "lunch" };
const profileDoc = {
  id: 21,
  seller: 7,
  openid: null,
  displayName: "王阿姨",
  address: "3A-1201",
  active: true
};
const orderDoc = {
  id: 31,
  seller: 7,
  mealSlot: 11,
  customerProfile: 21,
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
  note: "少辣"
};

type PayloadOptions = {
  membershipActive?: boolean;
  sellerActive?: boolean;
  slots?: Array<Record<string, unknown>>;
  profiles?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  createError?: unknown;
  updateError?: unknown;
  database?: "postgres" | "sqlite";
};

function matchesOwned(where: unknown, docs: Array<Record<string, unknown>>) {
  const serialized = JSON.stringify(where);
  if (!serialized.includes("\"id\"")) return docs;
  const match = docs.find(({ id }) =>
    serialized.includes(`\"equals\":${JSON.stringify(id)}`) ||
    serialized.includes(`\"equals\":${JSON.stringify(String(id))}`));
  return match ? [match] : [];
}

function payloadWith(options: PayloadOptions = {}) {
  const slots = options.slots ?? [slotDoc];
  const profiles = options.profiles ?? [profileDoc];
  const orders = options.orders ?? [orderDoc];
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
    if (collection === "kiv1_operators") return { docs: options.membershipActive === false ? [] : [{ id: 1 }] };
    if (collection === "kiv1_sellers") return { docs: options.sellerActive === false ? [] : [sellerDoc] };
    if (collection === "kiv1_meal_slots") return { docs: matchesOwned(where, slots) };
    if (collection === "kiv1_customer_profiles") return { docs: matchesOwned(where, profiles) };
    if (collection === "kiv1_orders") return { docs: matchesOwned(where, orders) };
    return { docs: [] };
  });
  const create = options.createError
    ? vi.fn(async () => { throw options.createError; })
    : vi.fn(async ({ collection, data }: { collection: string; data: Record<string, unknown> }) => ({
      id: collection === "kiv1_customer_profiles" ? 22 : 32,
      ...data
    }));
  const update = options.updateError
    ? vi.fn(async () => { throw options.updateError; })
    : vi.fn(async ({ id, data }: { id: string | number; data: Record<string, unknown> }) => ({ ...orderDoc, id, ...data }));
  const execute = vi.fn(async () => ({ rows: [] }));
  return { find, create, update, execute,
    db: { name: options.database ?? "sqlite", sessions: { tx: { db: {} } }, execute } };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`http://cms.test/api/internal/kiv1${path}`, {
    ...init,
    headers: {
      "x-kith-inn-v1-operator": token,
      "x-kith-inn-v1-internal": INTERNAL,
      ...init.headers
    }
  });
}

function json(path: string, method: "POST" | "PATCH", body: unknown) {
  return request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createLocalReq.mockResolvedValue({ transactionID: Promise.resolve("tx") });
  mocks.initTransaction.mockResolvedValue(true);
  mocks.commitTransaction.mockResolvedValue(undefined);
  mocks.killTransaction.mockResolvedValue(undefined);
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("seller and customer-profile persistence boundary", () => {
  it("returns the token seller and lists normalized active profiles with search", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const seller = await getSeller(request("/seller"));
    expect(seller.status).toBe(200);
    await expect(seller.json()).resolves.toEqual({ doc: sellerDoc });

    const profiles = await profileRoutes.GET(request("/customer-profiles?query=%E7%8E%8B"));
    expect(profiles.status).toBe(200);
    await expect(profiles.json()).resolves.toEqual({ docs: [{
      id: 21,
      sellerId: 7,
      openid: null,
      displayName: "王阿姨",
      address: "3A-1201",
      active: true
    }] });
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_customer_profiles",
      where: { and: [
        { seller: { equals: 7 } },
        { active: { equals: true } },
        { or: [{ displayName: { contains: "王" } }, { address: { contains: "王" } }] }
      ] },
      sort: ["displayName", "address"]
    }));
  });

  it("creates profiles with seller stamp and a forced null openid", async () => {
    const payload = payloadWith({ profiles: [] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await profileRoutes.POST(json("/customer-profiles", "POST", {
      displayName: " 王阿姨 ",
      address: " 3A-1201 "
    }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith({
      collection: "kiv1_customer_profiles",
      data: { seller: 7, displayName: "王阿姨", address: "3A-1201", openid: null, active: true },
      overrideAccess: true
    });
  });

  it("rejects invalid profile input and fails closed for an inactive membership", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await profileRoutes.POST(json("/customer-profiles", "POST", {
      displayName: "王阿姨",
      address: "3A",
      openid: "forged"
    }))).status).toBe(422);
    expect((await profileRoutes.POST(request("/customer-profiles", { method: "POST" }))).status).toBe(400);
    expect((await profileRoutes.GET(request(`/customer-profiles?query=${"x".repeat(241)}`))).status).toBe(400);

    mocks.getPayload.mockResolvedValue(payloadWith({ membershipActive: false }));
    expect((await getSeller(request("/seller"))).status).toBe(403);
  });
});

describe("order persistence boundary", () => {
  const createInput = {
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
    note: "少辣"
  };

  it("lists orders only after validating the owned meal slot", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await listOrders(request("/orders?mealSlotId=11"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
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
      note: "少辣"
    }] });
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_orders",
      where: { and: [{ seller: { equals: 7 } }, { mealSlot: { equals: 11 } }] }
    }));
  });

  it("normalizes nullable imported-order relationships and address", async () => {
    const imported = {
      ...orderDoc,
      id: 32,
      customerProfile: null,
      source: "jielong-import",
      displayName: "接龙顾客",
      address: null
    };
    mocks.getPayload.mockResolvedValue(payloadWith({ orders: [imported] }));
    const response = await listOrders(request("/orders?mealSlotId=11"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
      id: 32,
      sellerId: 7,
      mealSlotId: 11,
      customerProfileId: null,
      status: "draft",
      source: "jielong-import",
      displayName: "接龙顾客",
      address: null,
      quantity: 2,
      unitPriceCents: 3000,
      totalCents: 6000,
      paymentStatus: "unpaid",
      paidAt: null,
      deliveryStatus: "pending",
      deliveredAt: null,
      confirmedAt: null,
      canceledAt: null,
      note: "少辣"
    }] });
  });

  it("sorts normalized nullable addresses independently of database null ordering", async () => {
    const imported = {
      ...orderDoc,
      id: 32,
      customerProfile: null,
      source: "jielong-import",
      displayName: "接龙顾客",
      address: null
    };
    mocks.getPayload.mockResolvedValue(payloadWith({ orders: [imported, orderDoc] }));
    const response = await listOrders(request("/orders?mealSlotId=11"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ docs: [{ id: 31 }, { id: 32 }] });
  });

  it("validates both relationships and stamps seller on create", async () => {
    const payload = payloadWith({ orders: [] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await createOrder(json("/orders", "POST", createInput));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith({
      collection: "kiv1_orders",
      data: {
        seller: 7,
        mealSlot: 11,
        customerProfile: 21,
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
        note: "少辣"
      },
      overrideAccess: true
    });
  });

  it("patches only BE-decided snapshot and lifecycle fields after an owned lookup", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await orderRoute.PATCH(json("/orders/31", "PATCH", {
      quantity: 3,
      displayName: "王姨",
      address: "3A-1202",
      note: null
    }), { params: Promise.resolve({ id: "31" }) });
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_orders",
      id: 31,
      data: { quantity: 3, displayName: "王姨", address: "3A-1202", note: null },
      overrideAccess: true,
      req: expect.anything()
    });

    const lifecycle = {
      status: "confirmed",
      confirmedAt: "2026-07-11T00:00:00.000Z",
      canceledAt: null,
      paymentStatus: "paid",
      paidAt: "2026-07-11T00:01:00.000Z",
      deliveryStatus: "done",
      deliveredAt: "2026-07-11T00:02:00.000Z"
    };
    const lifecycleResponse = await orderRoute.PATCH(json("/orders/31", "PATCH", lifecycle), {
      params: Promise.resolve({ id: "31" })
    });
    expect(lifecycleResponse.status).toBe(200);
    expect(payload.update).toHaveBeenLastCalledWith({
      collection: "kiv1_orders",
      id: 31,
      data: lifecycle,
      overrideAccess: true,
      req: expect.anything()
    });
  });

  it("atomically rejects stale merchant lifecycle writes after customer cancellation", async () => {
    const payload = payloadWith({ database: "postgres", orders: [{
      ...orderDoc, status: "canceled", canceledAt: "2026-07-11T00:00:00.000Z"
    }] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await orderRoute.PATCH(json("/orders/31", "PATCH", {
      status: "confirmed", confirmedAt: "2026-07-11T00:01:00.000Z", canceledAt: null
    }), { params: Promise.resolve({ id: "31" }) });
    expect(response.status).toBe(409);
    const repeatedCancel = await orderRoute.PATCH(json("/orders/31", "PATCH", {
      status: "canceled", canceledAt: "2026-07-11T00:02:00.000Z"
    }), { params: Promise.resolve({ id: "31" }) });
    expect(repeatedCancel.status).toBe(409);
    expect(payload.execute).toHaveBeenCalledTimes(2);
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("rejects malformed order ids before taking the PostgreSQL row lock", async () => {
    const payload = payloadWith({ database: "postgres" });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await orderRoute.PATCH(json("/orders/not-a-number", "PATCH", { quantity: 3 }), {
      params: Promise.resolve({ id: "not-a-number" })
    });
    expect(response.status).toBe(404);
    expect(payload.execute).not.toHaveBeenCalled();
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("rejects operator-only PATCH calls before lifecycle fields reach Payload", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await orderRoute.PATCH(new Request("http://cms.test/api/internal/kiv1/orders/31", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-kith-inn-v1-operator": token
      },
      body: JSON.stringify({ status: "confirmed" })
    }), { params: Promise.resolve({ id: "31" }) });
    expect(response.status).toBe(401);
    expect(payload.update).not.toHaveBeenCalled();
  });

  it("rejects missing/cross-seller relationships, extra fields and malformed JSON", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ slots: [] }));
    expect((await listOrders(request("/orders?mealSlotId=99"))).status).toBe(404);
    expect((await createOrder(json("/orders", "POST", createInput))).status).toBe(422);

    mocks.getPayload.mockResolvedValue(payloadWith({ profiles: [] }));
    expect((await createOrder(json("/orders", "POST", createInput))).status).toBe(422);

    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await createOrder(json("/orders", "POST", { ...createInput, seller: 99 }))).status).toBe(422);
    expect((await createOrder(request("/orders", { method: "POST" }))).status).toBe(400);
    expect((await listOrders(request("/orders"))).status).toBe(400);
    expect((await orderRoute.PATCH(json("/orders/31", "PATCH", {
      quantity: 3,
      confirmedImpactAccepted: true
    }), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(422);
    expect((await orderRoute.PATCH(json("/orders/31", "PATCH", { mealSlotId: 12 }), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(422);
  });

  it("uses 404 for foreign orders and normalizes unique/write failures", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ orders: [] }));
    expect((await orderRoute.PATCH(json("/orders/99", "PATCH", { quantity: 3 }), {
      params: Promise.resolve({ id: "99" })
    })).status).toBe(404);

    mocks.getPayload.mockResolvedValue(payloadWith({ orders: [], createError: new Error("duplicate key") }));
    expect((await createOrder(json("/orders", "POST", createInput))).status).toBe(409);

    mocks.getPayload.mockResolvedValue(payloadWith({ updateError: new Error("offline") }));
    expect((await orderRoute.PATCH(json("/orders/31", "PATCH", { quantity: 3 }), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(500);
  });
});
