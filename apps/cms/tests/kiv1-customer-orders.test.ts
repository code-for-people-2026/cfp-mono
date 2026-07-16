import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCustomerToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  createLocalReq: vi.fn(),
  initTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn()
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

import { GET as listOrders, POST as createOrder } from "../src/app/api/internal/kiv1/customer/orders/route";
import { PATCH as updateOrder, POST as cancelOrder } from "../src/app/api/internal/kiv1/customer/orders/[id]/route";
import { GET as findBySlot } from "../src/app/api/internal/kiv1/customer/orders/by-slot/[mealSlotId]/route";

const SECRET = "v1-secret";
const INTERNAL = "v1-internal";
const BATCH_PUBLIC_ID = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
const originalEnv = { ...process.env };
const ownerToken = await issueCustomerToken({ sellerId: 7, openid: "wx-owner" }, SECRET);
const neighborToken = await issueCustomerToken({ sellerId: 7, openid: "wx-neighbor" }, SECRET);
const foreignSellerToken = await issueCustomerToken({ sellerId: 8, openid: "wx-owner" }, SECRET);
const operatorToken = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const menuItems = [
  { offering: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
  { offering: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
  { offering: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
  { offering: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
  { offering: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
];
const slots = [
  { id: 11, seller: 7, date: "2026-07-13", occasion: "lunch", menuItems,
    orderStatus: "open", orderDeadline: "2099-07-20T00:00:00.000Z" },
  { id: 12, seller: 8, date: "2026-07-13", occasion: "dinner", menuItems,
    orderStatus: "open", orderDeadline: "2099-07-20T00:00:00.000Z" },
  { id: 13, seller: 7, date: "2026-07-14", occasion: "dinner", menuItems,
    orderStatus: "closed", orderDeadline: "2026-07-13T00:00:00.000Z" }
];
const profiles = [
  { id: 21, seller: 7, openid: "wx-owner", active: true },
  { id: 22, seller: 7, openid: "wx-neighbor", active: true },
  { id: 23, seller: 8, openid: "wx-owner", active: true },
  { id: 24, seller: 7, openid: "wx-owner", active: false },
  { id: 25, seller: 7, openid: "wx-owner", active: true },
  { id: 26, seller: 7, openid: "wx-owner", active: true }
];
const order = {
  id: 31, seller: 7, mealSlot: 11, customerProfile: 21, customerOpenid: "wx-owner",
  status: "draft", source: "customer-card", displayName: "王阿姨", address: "3A",
  quantity: 2, unitPriceCents: 3000, paymentStatus: "unpaid", paidAt: null,
  deliveryStatus: "pending", deliveredAt: null, confirmedAt: null, canceledAt: null, note: null
};
const orders = [
  order,
  { ...order, id: 32, customerProfile: 22, customerOpenid: "wx-neighbor" },
  { ...order, id: 33, seller: 8, mealSlot: 12, customerProfile: 23 },
  { ...order, id: 34, customerProfile: 25, source: "manual" },
  { ...order, id: 35, mealSlot: 13, customerProfile: 24, status: "canceled",
    displayName: "停用前称呼", address: "历史地址", quantity: 1, unitPriceCents: 2800,
    canceledAt: "2026-07-12T00:00:00.000Z" }
];

function includes(where: unknown, field: string, value: unknown) {
  const text = JSON.stringify(where);
  return text.includes(`\"${field}\"`) && (
    text.includes(`\"equals\":${JSON.stringify(value)}`)
    || text.includes(`\"equals\":${JSON.stringify(String(value))}`)
  );
}

function matching(where: unknown, docs: Array<Record<string, unknown>>) {
  const text = JSON.stringify(where);
  return docs.filter((doc) => Object.entries(doc).every(([field, value]) =>
    !text.includes(`\"${field}\"`) || includes(where, field, value)
  ));
}

function payloadWith(options: {
  createError?: unknown;
  updateError?: unknown;
  orderStatus?: "draft" | "confirmed" | "canceled";
  batchStatus?: "open" | "closed"; slotStatus?: "open" | "closed"; orderDeadline?: string | null;
  slotPrice?: number | null;
  profileActive?: boolean;
  database?: "postgres" | "sqlite";
} = {}) {
  const currentOrders = orders.map((doc) => doc.id === 31 && options.orderStatus
    ? { ...doc, status: options.orderStatus }
    : doc);
  const currentSlots = slots.map((slot) => slot.id === 11
    ? { ...slot, orderStatus: options.slotStatus ?? slot.orderStatus,
      orderDeadline: options.orderDeadline === undefined ? slot.orderDeadline : options.orderDeadline,
      priceCents: options.slotPrice ?? null }
    : slot);
  const currentProfiles = profiles.map((profile) => profile.id === 21 && options.profileActive !== undefined
    ? { ...profile, active: options.profileActive } : profile);
  const find = vi.fn(async ({ collection, where, depth }: { collection: string; where?: unknown; depth?: number }) => {
    if (collection === "kiv1_sellers") return { docs: matching(where, [{ id: 7, status: "active", defaultPriceCents: 3000 }, { id: 8, status: "active", defaultPriceCents: 3000 }]) };
    if (collection === "kiv1_booking_batches") return { docs: matching(where, [{ id: 41, seller: 7,
      publicId: BATCH_PUBLIC_ID, status: options.batchStatus ?? "open", mealSlots: [11] }]) };
    if (collection === "kiv1_meal_slots") return { docs: matching(where, currentSlots) };
    if (collection === "kiv1_customer_profiles") return { docs: matching(where, currentProfiles) };
    if (collection === "kiv1_orders") {
      const docs = matching(where, currentOrders);
      return { docs: depth === 1 ? docs.map((doc) => ({
        ...doc,
        mealSlot: currentSlots.find((slot) => slot.id === doc.mealSlot)
      })) : docs };
    }
    return { docs: [] };
  });
  const create = options.createError
    ? vi.fn(async () => { throw options.createError; })
    : vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 35, ...data }));
  const update = options.updateError
    ? vi.fn(async () => { throw options.updateError; })
    : vi.fn(async ({ id, data }: { id: string; data: Record<string, unknown> }) => ({
      ...currentOrders.find((doc) => String(doc.id) === id), id, ...data
    }));
  const execute = vi.fn(async () => ({ rows: [] }));
  return {
    find, create, update, execute,
    db: { name: options.database ?? "postgres", sessions: { tx: { db: {} } }, execute }
  };
}

function request(path: string, options: {
  method?: string; body?: unknown; token?: string; internal?: boolean; batch?: boolean
} = {}) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers["x-kith-inn-v1-customer"] = options.token;
  if (options.internal !== false) headers["x-kith-inn-v1-internal"] = INTERNAL;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const method = options.method ?? "GET";
  const query = method !== "GET" && options.batch !== false ? `${path.includes("?") ? "&" : "?"}batchPublicId=${BATCH_PUBLIC_ID}` : "";
  return new Request(`http://cms.test/api/internal/kiv1/customer/orders${path}${query}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

const createInput = {
  mealSlotId: 11, customerProfileId: 21, customerOpenid: "wx-owner", status: "draft",
  source: "customer-card", displayName: "王阿姨", address: "3A", quantity: 2,
  unitPriceCents: 3000, paymentStatus: "unpaid", paidAt: null, deliveryStatus: "pending",
  deliveredAt: null, confirmedAt: null, canceledAt: null, note: null
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createLocalReq.mockResolvedValue({ transactionID: Promise.resolve("tx") });
  mocks.initTransaction.mockResolvedValue(true);
  mocks.commitTransaction.mockResolvedValue(undefined);
  mocks.killTransaction.mockResolvedValue(undefined);
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});

afterEach(() => { process.env = { ...originalEnv }; });

describe("customer order persistence boundary", () => {
  it.each(["postgres", "sqlite"] as const)("lists only owner customer-card history on %s", async (database) => {
    const payload = payloadWith({ database, slotStatus: "closed" });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await listOrders(request("", { token: ownerToken, internal: false }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.docs.map((doc: { id: number }) => doc.id)).toEqual([35, 31]);
    expect(body.docs[0]).toMatchObject({
      target: { date: "2026-07-14", occasion: "dinner" },
      displayName: "停用前称呼",
      address: "历史地址",
      quantity: 1,
      unitPriceCents: 2800,
      totalCents: 2800,
      status: "canceled",
      paymentStatus: "unpaid",
      deliveryStatus: "pending"
    });
    expect(body.docs[0].menuItems[0]).toEqual({
      nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat"
    });
    for (const hidden of ["sellerId", "customerOpenid", "source", "mealSlotId", "customerProfileId"]) {
      expect(JSON.stringify(body)).not.toContain(hidden);
    }
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_orders",
      where: { and: [
        { seller: { equals: 7 } },
        { customerOpenid: { equals: "wx-owner" } },
        { source: { equals: "customer-card" } }
      ] },
      depth: 1
    }));
  });

  it("isolates own-order history across both owner axes and rejects operator sessions", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    await expect((await listOrders(request("", { token: neighborToken, internal: false }))).json())
      .resolves.toMatchObject({ docs: [{ id: 32 }] });
    await expect((await listOrders(request("", { token: foreignSellerToken, internal: false }))).json())
      .resolves.toMatchObject({ docs: [{ id: 33 }] });
    expect((await listOrders(request("", { token: operatorToken, internal: false }))).status).toBe(401);
  });

  it("finds an existing order only at the complete owner+slot+profile coordinate", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await findBySlot(request("/by-slot/11?customerProfileId=21"), {
      params: Promise.resolve({ mealSlotId: "11" })
    })).status).toBe(401);
    const response = await findBySlot(request("/by-slot/11?customerProfileId=21", { token: ownerToken }), {
      params: Promise.resolve({ mealSlotId: "11" })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.doc).toMatchObject({ id: 31, sellerId: 7, mealSlotId: 11, customerProfileId: 21 });
    expect(JSON.stringify(body)).not.toContain("openid");
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_orders",
      where: { and: [
        { seller: { equals: 7 } }, { customerOpenid: { equals: "wx-owner" } },
        { mealSlot: { equals: 11 } }, { customerProfile: { equals: 21 } }
      ] }
    }));
    expect((await findBySlot(request("/by-slot/11", { token: ownerToken }), {
      params: Promise.resolve({ mealSlotId: "11" })
    })).status).toBe(400);
    await expect((await findBySlot(request("/by-slot/11?customerProfileId=25", { token: ownerToken }), {
      params: Promise.resolve({ mealSlotId: "11" })
    })).json()).resolves.toMatchObject({ doc: { id: 34, source: "manual" } });
    await expect((await findBySlot(request("/by-slot/11?customerProfileId=26", { token: ownerToken }), {
      params: Promise.resolve({ mealSlotId: "11" })
    })).json()).resolves.toEqual({ doc: null });
  });

  it("rejects cross-seller, cross-openid and inactive relationships atomically", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    for (const input of [
      { ...createInput, mealSlotId: 12 },
      { ...createInput, customerProfileId: 22 },
      { ...createInput, customerProfileId: 24 },
      { ...createInput, customerOpenid: "wx-neighbor" }
    ]) {
      expect((await createOrder(request("", { method: "POST", body: input, token: ownerToken }))).status).toBe(409);
    }
    expect((await findBySlot(request("/by-slot/12?customerProfileId=21", { token: ownerToken }), {
      params: Promise.resolve({ mealSlotId: "12" })
    })).status).toBe(409);
  });

  it("requires both auth domains, stamps seller and returns a customer-card whitelist", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await createOrder(request("", {
      method: "POST", body: createInput, token: ownerToken, internal: false
    }))).status).toBe(401);
    expect((await createOrder(request("", { method: "POST", body: createInput }))).status).toBe(401);
    expect((await createOrder(request("", { method: "POST", body: createInput, token: operatorToken }))).status).toBe(401);
    const response = await createOrder(request("", { method: "POST", body: createInput, token: ownerToken }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_orders",
      data: expect.objectContaining({
        seller: 7, mealSlot: 11, customerProfile: 21, customerOpenid: "wx-owner",
        source: "customer-card", displayName: "王阿姨", quantity: 2
      }),
      overrideAccess: true
    }));
    expect(JSON.stringify(await response.json())).not.toContain("openid");
  });

  it("normalizes strict input, unique conflicts and persistence failures", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    const malformed = new Request("http://cms.test/api/internal/kiv1/customer/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-kith-inn-v1-customer": ownerToken,
        "x-kith-inn-v1-internal": INTERNAL
      },
      body: "{"
    });
    expect((await createOrder(malformed)).status).toBe(400);
    expect((await createOrder(request("", {
      method: "POST", body: { ...createInput, seller: 8 }, token: ownerToken
    }))).status).toBe(422);
    mocks.getPayload.mockResolvedValue(payloadWith({ createError: new Error("duplicate key unique constraint") }));
    await expect((await createOrder(request("", {
      method: "POST", body: createInput, token: ownerToken
    }))).json()).resolves.toEqual({ error: "order-exists" });
    mocks.getPayload.mockResolvedValue(payloadWith({ createError: new Error("offline") }));
    expect((await createOrder(request("", { method: "POST", body: createInput, token: ownerToken }))).status).toBe(500);
  });

  it("updates only customer-card orders owned by both seller and openid", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const context = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken, internal: false
    }), context("31"))).status).toBe(401);
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: neighborToken
    }), context("31"))).status).toBe(404);
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: foreignSellerToken
    }), context("31"))).status).toBe(404);
    expect((await updateOrder(request("/34?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken
    }), context("34"))).status).toBe(404);
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3, customerOpenid: "forged" }, token: ownerToken
    }), context("31"))).status).toBe(422);
    vi.clearAllMocks();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3, unitPriceCents: 3200 }, token: ownerToken
    }), context("31"));
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_orders", id: 31, data: { quantity: 3, unitPriceCents: 3000 }, overrideAccess: true,
      req: expect.anything()
    }));
    expect(payload.execute.mock.invocationCallOrder[0]).toBeLessThan(payload.find.mock.invocationCallOrder.at(-1)!);
    expect(mocks.commitTransaction).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain("openid");
  });

  it("atomically rejects merchant status races while allowing explicit canceled resubmission", async () => {
    const confirmed = payloadWith({ orderStatus: "confirmed" });
    mocks.getPayload.mockResolvedValue(confirmed);
    const context = { params: Promise.resolve({ id: "31" }) };
    const raced = await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken
    }), context);
    expect(raced.status).toBe(409);
    await expect(raced.json()).resolves.toMatchObject({ error: "customer-order-status-changed" });
    expect(confirmed.update).not.toHaveBeenCalled();

    const canceled = payloadWith({ orderStatus: "canceled", database: "sqlite" });
    mocks.getPayload.mockResolvedValue(canceled);
    const resubmitted = await updateOrder(request("/31?expectedStatus=canceled", {
      method: "PATCH", body: { status: "draft", canceledAt: null }, token: ownerToken
    }), context);
    expect(resubmitted.status).toBe(200);
    expect(canceled.execute).not.toHaveBeenCalled();
  });

  it("cancels only an available owner draft under the customer write lock", async () => {
    const context = { params: Promise.resolve({ id: "31" }) };
    for (const [payload, token, status, code] of [
      [payloadWith(), neighborToken, 404, "customer-order-not-found"],
      [payloadWith({ orderStatus: "confirmed" }), ownerToken, 409, "customer-order-status-changed"],
      [payloadWith({ slotStatus: "closed" }), ownerToken, 409, "meal-slot-closed"]
    ] as const) {
      mocks.getPayload.mockResolvedValue(payload);
      const response = await cancelOrder(request("/31", {
        method: "POST", body: { confirmed: true }, token
      }), context);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: code });
      expect(payload.update).not.toHaveBeenCalled();
    }
    const payload = payloadWith({ database: "sqlite", profileActive: false });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await cancelOrder(request("/31", {
      method: "POST", body: { confirmed: true }, token: ownerToken
    }), context);
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_orders", id: 31,
      data: { status: "canceled", canceledAt: expect.any(String) },
      overrideAccess: true, req: expect.anything()
    }));
    expect(payload.execute).not.toHaveBeenCalled();
    expect((await cancelOrder(request("/31", {
      method: "POST", body: { confirmed: false }, token: ownerToken
    }), context)).status).toBe(422);
    expect((await cancelOrder(new Request("http://cms.test/api/internal/kiv1/customer/orders/31", {
      method: "POST", headers: { "x-kith-inn-v1-customer": ownerToken, "x-kith-inn-v1-internal": INTERNAL }, body: "{"
    }), context)).status).toBe(400);
  });

  it("rechecks batch, slot and deadline inside the customer write transaction", async () => {
    for (const [payload, code] of [
      [payloadWith({ batchStatus: "closed" }), "booking-batch-closed"],
      [payloadWith({ slotStatus: "closed" }), "meal-slot-closed"],
      [payloadWith({ orderDeadline: "2020-01-01T00:00:00.000Z" }), "order-deadline-passed"]
    ] as const) {
      mocks.getPayload.mockResolvedValue(payload);
      const response = await createOrder(request("", { method: "POST", body: createInput, token: ownerToken }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: code });
      expect(payload.create).not.toHaveBeenCalled();
    }
    const closed = payloadWith({ slotStatus: "closed" });
    mocks.getPayload.mockResolvedValue(closed);
    const response = await updateOrder(request("/31?expectedStatus=draft", { method: "PATCH",
      body: { quantity: 3 }, token: ownerToken }), { params: Promise.resolve({ id: "31" }) });
    await expect(response.json()).resolves.toMatchObject({ error: "meal-slot-closed" });
    expect(closed.update).not.toHaveBeenCalled();
    const repriced = payloadWith({ slotPrice: 2800 });
    mocks.getPayload.mockResolvedValue(repriced);
    expect((await createOrder(request("", { method: "POST", body: createInput, token: ownerToken }))).status).toBe(201);
    expect(repriced.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ unitPriceCents: 2800 }) }));
    const invalid = payloadWith();
    mocks.getPayload.mockResolvedValue(invalid);
    const rejected = await createOrder(request("", { method: "POST", body: { ...createInput, mealSlotId: "undefined" }, token: ownerToken }));
    expect(rejected.status).toBe(409);
    expect(invalid.execute).not.toHaveBeenCalled();
  });

  it("normalizes order update failures", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ updateError: new Error("offline") }));
    expect((await updateOrder(new Request("http://cms.test/api/internal/kiv1/customer/orders/31", {
      method: "PATCH",
      headers: {
        "content-type": "application/json", "x-kith-inn-v1-customer": ownerToken,
        "x-kith-inn-v1-internal": INTERNAL
      },
      body: "{"
    }), { params: Promise.resolve({ id: "31" }) })).status).toBe(400);
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken
    }), { params: Promise.resolve({ id: "31" }) })).status).toBe(500);
    expect(mocks.killTransaction).toHaveBeenCalledOnce();
    expect((await updateOrder(request("/31", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken
    }), { params: Promise.resolve({ id: "31" }) })).status).toBe(400);
  });

  it("fails closed when the database transaction or row-lock session is unavailable", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const context = { params: Promise.resolve({ id: "31" }) };
    mocks.initTransaction.mockResolvedValueOnce(false);
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken
    }), context)).status).toBe(500);
    expect(payload.update).not.toHaveBeenCalled();
    expect(mocks.killTransaction).not.toHaveBeenCalled();

    mocks.createLocalReq.mockResolvedValueOnce({ transactionID: Promise.resolve(null) });
    expect((await updateOrder(request("/31?expectedStatus=draft", {
      method: "PATCH", body: { quantity: 3 }, token: ownerToken
    }), context)).status).toBe(500);
    expect(mocks.killTransaction).toHaveBeenCalledOnce();
  });
});
