import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()), ...mocks
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { GET, PATCH } from "../src/app/api/internal/kiv1/seller/route";

const SECRET = "v1-secret";
const INTERNAL = "internal-secret";
const originalEnv = { ...process.env };
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);

function payloadWith() {
  return {
    find: vi.fn(async ({ collection }: { collection: string }) => collection === "kiv1_operators"
      ? { docs: [{ id: 1, seller: 7, active: true }] }
      : { docs: [{ id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" }] }),
    update: vi.fn(async ({ id, data }: { id: string | number; data: Record<string, unknown> }) => ({
      id, name: "桃子", status: "active", ...data
    }))
  };
}

const request = (init: RequestInit = {}) => new Request("http://cms.test/api/internal/kiv1/seller", {
  ...init,
  headers: { "x-kith-inn-v1-operator": token, ...init.headers }
});

beforeEach(() => {
  vi.resetAllMocks();
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});
afterEach(() => { process.env = { ...originalEnv }; });

describe("seller booking settings", () => {
  it("reads only the seller from the operator scope", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ doc: { id: 7, defaultPriceCents: 3000 } });
  });

  it("updates only the scoped seller default price through service auth", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await PATCH(request({
      method: "PATCH",
      headers: { "content-type": "application/json", "x-kith-inn-v1-internal": INTERNAL },
      body: JSON.stringify({ defaultPriceCents: 3200 })
    }));
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_sellers", id: 7, data: { defaultPriceCents: 3200 }, overrideAccess: true
    });
    await expect(response.json()).resolves.toEqual({ defaultPriceCents: 3200 });
  });

  it("rejects malformed, forged and unauthenticated updates", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    const call = (body: unknown, internal = INTERNAL) => PATCH(request({
      method: "PATCH",
      headers: { "content-type": "application/json", "x-kith-inn-v1-internal": internal },
      body: JSON.stringify(body)
    }));
    expect((await call({ defaultPriceCents: -1 })).status).toBe(422);
    expect((await call({ defaultPriceCents: 3200, sellerId: 9 })).status).toBe(422);
    expect((await call({ defaultPriceCents: 3200 }, "wrong")).status).toBe(401);
    expect((await PATCH(request({ method: "PATCH", body: "{" }))).status).toBe(401);
  });
});
