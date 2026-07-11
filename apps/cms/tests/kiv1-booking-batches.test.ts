import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { GET, POST } from "../src/app/api/internal/kiv1/booking-batches/route";
import * as detailRoute from "../src/app/api/internal/kiv1/booking-batches/[id]/route";

const SECRET = "v1-secret";
const INTERNAL = "internal-secret";
const originalEnv = { ...process.env };
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const batchDoc = {
  id: 31,
  seller: 7,
  publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
  title: "7 月 13 日预订",
  status: "open",
  mealSlots: [11, 12],
  createdBy: 1
};

type Options = {
  batches?: Array<Record<string, unknown>>;
  slotIds?: Array<string | number>;
  operatorIds?: Array<string | number>;
  createError?: unknown;
};

function payloadWith(options: Options = {}) {
  const batches = options.batches ?? [batchDoc];
  const slotIds = options.slotIds ?? [11, 12];
  const operatorIds = options.operatorIds ?? [1];
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
    if (collection === "kiv1_sellers") return { docs: [{ id: 7, status: "active" }] };
    if (collection === "kiv1_operators") {
      const serialized = JSON.stringify(where);
      const id = operatorIds.find((value) => serialized.includes(`\"equals\":${JSON.stringify(value)}`));
      return { docs: id === undefined ? [] : [{ id, seller: 7, active: true }] };
    }
    if (collection === "kiv1_meal_slots") {
      const serialized = JSON.stringify(where);
      const id = slotIds.find((value) => serialized.includes(`\"equals\":${JSON.stringify(value)}`));
      return { docs: id === undefined ? [] : [{ id, seller: 7 }] };
    }
    if (collection === "kiv1_booking_batches") {
      const serialized = JSON.stringify(where);
      const byId = batches.filter(({ id }) => !serialized.includes("\"id\"") ||
        serialized.includes(`\"equals\":${JSON.stringify(id)}`) ||
        serialized.includes(`\"equals\":\"${String(id)}\"`));
      return { docs: byId };
    }
    return { docs: [] };
  });
  return {
    find,
    create: options.createError
      ? vi.fn(async () => { throw options.createError; })
      : vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 32, ...data })),
    update: vi.fn(async ({ id, data }: { id: string; data: Record<string, unknown> }) => ({
      ...batchDoc,
      id,
      ...data
    }))
  };
}

function request(path = "", init: RequestInit = {}) {
  return new Request(`http://cms.test/api/internal/kiv1/booking-batches${path}`, {
    ...init,
    headers: { "x-kith-inn-v1-operator": token, ...init.headers }
  });
}

function write(path: string, method: "POST" | "PATCH", body: unknown, internal = true) {
  return request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(internal ? { "x-kith-inn-v1-internal": INTERNAL } : {})
    },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("GET /api/internal/kiv1/booking-batches", () => {
  it("lists normalized batches for the token seller and optional status", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await GET(request("?status=open"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
      id: 31,
      sellerId: 7,
      publicId: batchDoc.publicId,
      title: batchDoc.title,
      status: "open",
      mealSlotIds: [11, 12],
      createdById: 1
    }] });
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_booking_batches",
      where: { and: [{ seller: { equals: 7 } }, { status: { equals: "open" } }] },
      sort: "-createdAt"
    }));
    expect((await GET(request("?status=bad"))).status).toBe(400);
  });
});

describe("POST /api/internal/kiv1/booking-batches", () => {
  const input = {
    publicId: "10a6c650-d190-4a32-baa3-b89a0679d90f",
    title: "一周预订",
    status: "open",
    mealSlotIds: [11, 12],
    createdById: 1
  };

  it("requires service auth, validates relationships and stamps seller", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await POST(write("", "POST", input, false))).status).toBe(401);
    const response = await POST(write("", "POST", input));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith({
      collection: "kiv1_booking_batches",
      data: {
        seller: 7,
        publicId: input.publicId,
        title: input.title,
        status: "open",
        mealSlots: [11, 12],
        createdBy: 1
      },
      overrideAccess: true
    });
  });

  it("rejects injected seller, foreign refs, invalid JSON and unique conflicts", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await POST(write("", "POST", { ...input, seller: 99 }))).status).toBe(422);
    expect((await POST(request("", {
      method: "POST",
      headers: { "x-kith-inn-v1-internal": INTERNAL },
      body: "{"
    }))).status).toBe(400);
    mocks.getPayload.mockResolvedValue(payloadWith({ slotIds: [11] }));
    expect((await POST(write("", "POST", input))).status).toBe(422);
    mocks.getPayload.mockResolvedValue(payloadWith({ operatorIds: [2] }));
    expect((await POST(write("", "POST", input))).status).toBe(403);
    mocks.getPayload.mockResolvedValue(payloadWith({ createError: new Error("duplicate key unique constraint") }));
    expect((await POST(write("", "POST", input))).status).toBe(409);
  });
});

describe("PATCH /api/internal/kiv1/booking-batches/:id", () => {
  it("closes owned batches idempotently without touching slots", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await detailRoute.PATCH(write("/31", "PATCH", { status: "closed" }, false), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(401);
    const response = await detailRoute.PATCH(write("/31", "PATCH", { status: "closed" }), {
      params: Promise.resolve({ id: "31" })
    });
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_booking_batches",
      id: "31",
      data: { status: "closed" },
      overrideAccess: true
    });
    expect(payload.update).not.toHaveBeenCalledWith(expect.objectContaining({ collection: "kiv1_meal_slots" }));

    const closedPayload = payloadWith({ batches: [{ ...batchDoc, status: "closed" }] });
    mocks.getPayload.mockResolvedValue(closedPayload);
    expect((await detailRoute.PATCH(write("/31", "PATCH", { status: "closed" }), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(200);
    expect(closedPayload.update).not.toHaveBeenCalled();
  });

  it("uses 404 for foreign ids and rejects invalid updates", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ batches: [] }));
    expect((await detailRoute.PATCH(write("/99", "PATCH", { status: "closed" }), {
      params: Promise.resolve({ id: "99" })
    })).status).toBe(404);
    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await detailRoute.PATCH(write("/31", "PATCH", { status: "open" }), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(422);
    mocks.getPayload.mockResolvedValue(payloadWith({ batches: [{ ...batchDoc, status: "archived" }] }));
    expect((await detailRoute.PATCH(write("/31", "PATCH", { status: "closed" }), {
      params: Promise.resolve({ id: "31" })
    })).status).toBe(409);
  });
});
