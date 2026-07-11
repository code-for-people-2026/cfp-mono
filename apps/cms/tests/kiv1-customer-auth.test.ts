import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCustomerToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { POST } from "../src/app/api/internal/kiv1/auth/customer-session/route";
import { GET } from "../src/app/api/internal/kiv1/customer/booking-batches/[publicId]/route";

const SECRET = "v1-secret";
const INTERNAL = "internal-secret";
const PUBLIC_ID = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
const originalEnv = { ...process.env };
const menuItems = [
  { offering: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
  { offering: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
  { offering: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
  { offering: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
  { offering: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
];

function payloadWith(options: { sellerStatus?: string; batchSeller?: number; status?: string } = {}) {
  const sellerStatus = options.sellerStatus ?? "active";
  const batchSeller = options.batchSeller ?? 7;
  const batch = {
    id: 31,
    seller: batchSeller,
    publicId: PUBLIC_ID,
    title: "7 月预订",
    status: options.status ?? "open",
    mealSlots: [11],
    createdBy: 1
  };
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
    const query = JSON.stringify(where);
    if (collection === "kiv1_sellers") {
      const requestedActive = query.includes('"status":{"equals":"active"}');
      return { docs: requestedActive && sellerStatus !== "active" ? [] : [{
        id: batchSeller,
        name: "桃子",
        defaultPriceCents: 3000,
        status: sellerStatus
      }] };
    }
    if (collection === "kiv1_booking_batches") {
      if (!query.includes(PUBLIC_ID) || query.includes('"seller":{"equals":8}')) return { docs: [] };
      return { docs: [batch] };
    }
    if (collection === "kiv1_meal_slots") return { docs: [{
      id: 11,
      seller: batchSeller,
      date: "2026-07-13",
      occasion: "lunch",
      menuItems,
      orderStatus: "open",
      orderDeadline: "2026-07-12T01:00:00.000Z",
      priceCents: null,
      generatedAt: "2026-07-10T01:00:00.000Z"
    }] };
    return { docs: [] };
  });
  return { find };
}

function bootstrap(body: unknown, internal = true) {
  return new Request("http://cms.test/api/internal/kiv1/auth/customer-session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(internal ? { "x-kith-inn-v1-internal": INTERNAL } : {})
    },
    body: JSON.stringify(body)
  });
}

async function customerRequest(token: string, publicId = PUBLIC_ID) {
  return GET(new Request(`http://cms.test/api/internal/kiv1/customer/booking-batches/${publicId}`, {
    headers: { "x-kith-inn-v1-customer": token }
  }), { params: Promise.resolve({ publicId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/internal/kiv1/auth/customer-session", () => {
  it("requires service auth and resolves an active seller without customer auth", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await POST(bootstrap({ batchPublicId: PUBLIC_ID }, false))).status).toBe(401);
    const response = await POST(bootstrap({ batchPublicId: PUBLIC_ID }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      seller: { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" },
      batch: { publicId: PUBLIC_ID, sellerId: 7 }
    });
  });

  it("returns 404 for unknown batches and 403 for inactive sellers", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await POST(bootstrap({ batchPublicId: "cdd3fa2d-bffd-45bc-8863-00f26767b796" }))).status).toBe(404);
    mocks.getPayload.mockResolvedValue(payloadWith({ sellerStatus: "inactive" }));
    expect((await POST(bootstrap({ batchPublicId: PUBLIC_ID }))).status).toBe(403);
  });
});

describe("GET /api/internal/kiv1/customer/booking-batches/:publicId", () => {
  it("accepts a customer token and keeps closed batches readable", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ status: "closed" }));
    const token = await issueCustomerToken({ sellerId: 7, openid: "wx-customer" }, SECRET);
    const response = await customerRequest(token);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      batch: { publicId: PUBLIC_ID, status: "closed" },
      slots: [{ id: 11, sellerId: 7 }]
    });
  });

  it("rejects operator/expired tokens and hides cross-seller batches", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    const operator = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
    expect((await customerRequest(operator)).status).toBe(401);
    const expired = await issueCustomerToken({ sellerId: 7, openid: "wx" }, SECRET, 1);
    expect((await customerRequest(expired)).status).toBe(401);
    const foreign = await issueCustomerToken({ sellerId: 8, openid: "wx" }, SECRET);
    expect((await customerRequest(foreign)).status).toBe(404);
  });
});
