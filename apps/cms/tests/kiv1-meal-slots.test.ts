import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { GET, POST } from "../src/app/api/internal/kiv1/meal-slots/route";
import * as detailRoute from "../src/app/api/internal/kiv1/meal-slots/[id]/route";

const SECRET = "v1-secret";
const originalEnv = { ...process.env };
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const generatedAt = "2026-07-10T01:00:00.000Z";
const menuItems = [
  { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
  { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
  { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
  { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
  { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
];
const storedItems = menuItems.map(({ offeringId, ...item }) => ({ offering: offeringId, ...item }));
const slotDoc = {
  id: 11,
  seller: 7,
  date: "2026-07-13",
  occasion: "lunch",
  menuItems: storedItems,
  orderStatus: "draft",
  priceCents: null,
  generatedAt
};

type PayloadOptions = {
  slots?: Array<Record<string, unknown>>;
  ownedOfferingIds?: Array<string | number>;
  createError?: unknown;
};

function payloadWith(options: PayloadOptions = {}) {
  const slots = options.slots ?? [slotDoc];
  const owned = options.ownedOfferingIds ?? [1, 2, 3, 4, 5, 6];
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
    if (collection === "kiv1_operators") return { docs: [{ id: 1 }] };
    if (collection === "kiv1_sellers") return { docs: [{ id: 7, status: "active" }] };
    if (collection === "kiv1_offerings") {
      const serialized = JSON.stringify(where);
      const id = owned.find((candidate) => serialized.includes(`\"equals\":${JSON.stringify(candidate)}`));
      return { docs: id === undefined ? [] : [{ id, seller: 7 }] };
    }
    return { docs: slots };
  });
  return {
    find,
    create: options.createError
      ? vi.fn(async () => { throw options.createError; })
      : vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 12, ...data })),
    update: vi.fn(async ({ id, data }: { id: string; data: Record<string, unknown> }) => ({
      ...slotDoc,
      id,
      ...data
    }))
  };
}

function request(path = "", init: RequestInit = {}) {
  return new Request(`http://cms.test/api/internal/kiv1/meal-slots${path}`, {
    ...init,
    headers: { "x-kith-inn-v1-operator": token, ...init.headers }
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
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("GET /api/internal/kiv1/meal-slots", () => {
  it("lists normalized seller-scoped slots in a valid date range", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await GET(request("?from=2026-07-01&to=2026-07-31"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
      id: 11,
      sellerId: 7,
      date: "2026-07-13",
      occasion: "lunch",
      menuItems,
      orderStatus: "draft",
      priceCents: null,
      generatedAt
    }] });
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_meal_slots",
      where: { and: [
        { seller: { equals: 7 } },
        { date: { greater_than_equal: "2026-07-01" } },
        { date: { less_than_equal: "2026-07-31" } }
      ] },
      sort: ["date", "occasion"]
    }));
  });

  it("rejects missing, reversed and longer-than-31-day ranges", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    for (const query of ["", "?from=bad&to=2026-07-01", "?from=2026-07-31&to=2026-07-01", "?from=2026-07-01&to=2026-08-01"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
  });
});

describe("POST /api/internal/kiv1/meal-slots", () => {
  it("stamps seller/draft and validates every nested offering owner", async () => {
    const payload = payloadWith({ slots: [] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await POST(json("", "POST", {
      date: "2026-07-13",
      occasion: "lunch",
      menuItems,
      generatedAt
    }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith({
      collection: "kiv1_meal_slots",
      data: {
        seller: 7,
        date: "2026-07-13",
        occasion: "lunch",
        menuItems: storedItems,
        generatedAt,
        orderStatus: "draft"
      },
      overrideAccess: true
    });
    expect(payload.find.mock.calls.filter(([args]) => args.collection === "kiv1_offerings")).toHaveLength(5);
  });

  it("rejects seller injection/cross-seller offerings and normalizes unique conflicts", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ slots: [], ownedOfferingIds: [1, 2, 3, 4] }));
    expect((await POST(json("", "POST", { date: "2026-07-13", occasion: "lunch", menuItems, generatedAt }))).status).toBe(422);
    expect((await POST(json("", "POST", { seller: 99, date: "2026-07-13", occasion: "lunch", menuItems, generatedAt }))).status).toBe(422);
    expect((await POST(request("", { method: "POST" }))).status).toBe(400);

    mocks.getPayload.mockResolvedValue(payloadWith({ slots: [], createError: new Error("duplicate key unique constraint") }));
    const conflict = await POST(json("", "POST", { date: "2026-07-13", occasion: "lunch", menuItems, generatedAt }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: "meal-slot-conflict" });
  });
});

describe("GET/PATCH /api/internal/kiv1/meal-slots/:id", () => {
  it("gets owned slots and patches only menuItems/generatedAt", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const detail = await detailRoute.GET(request("/11"), { params: Promise.resolve({ id: "11" }) });
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({ doc: { id: 11, sellerId: 7 } });

    const response = await detailRoute.PATCH(
      json("/11", "PATCH", { menuItems, generatedAt }),
      { params: Promise.resolve({ id: "11" }) }
    );
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_meal_slots",
      id: "11",
      data: { menuItems: storedItems, generatedAt },
      overrideAccess: true
    });
  });

  it("uses 404 for missing/cross-seller slots and rejects extra fields or foreign offerings", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ slots: [] }));
    expect((await detailRoute.GET(request("/99"), { params: Promise.resolve({ id: "99" }) })).status).toBe(404);
    expect((await detailRoute.PATCH(json("/99", "PATCH", { menuItems, generatedAt }), {
      params: Promise.resolve({ id: "99" })
    })).status).toBe(404);

    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await detailRoute.PATCH(json("/11", "PATCH", { priceCents: 1 }), {
      params: Promise.resolve({ id: "11" })
    })).status).toBe(422);

    mocks.getPayload.mockResolvedValue(payloadWith({ ownedOfferingIds: [1, 2, 3, 4] }));
    expect((await detailRoute.PATCH(json("/11", "PATCH", { menuItems, generatedAt }), {
      params: Promise.resolve({ id: "11" })
    })).status).toBe(422);
  });
});
