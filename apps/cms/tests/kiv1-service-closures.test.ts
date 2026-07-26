import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(), createLocalReq: vi.fn(), initTransaction: vi.fn(),
  commitTransaction: vi.fn(), killTransaction: vi.fn()
}));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()), ...mocks
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { GET, POST } from "../src/app/api/internal/kiv1/service-closures/route";
import { DELETE } from "../src/app/api/internal/kiv1/service-closures/[id]/route";

const SECRET = "v1-secret";
const INTERNAL = "internal-secret";
const originalEnv = { ...process.env };
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const closure = { id: 41, seller: 7, date: "2026-07-27", occasion: null, note: "休息" };

type Options = { closures?: Record<string, unknown>[]; openSlots?: boolean; orders?: boolean };
function payloadWith(options: Options = {}) {
  const closures = options.closures ?? [closure];
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
    if (collection === "kiv1_operators") return { docs: [{ id: 1, seller: 7, active: true }] };
    if (collection === "kiv1_sellers") return { docs: [{ id: 7, status: "active" }] };
    if (collection === "kiv1_service_closures") {
      const serialized = JSON.stringify(where);
      if (serialized.includes('"id"')) return { docs: closures.filter(({ id }) => serialized.includes(String(id))) };
      const occasion = serialized.includes('"occasion":{"equals":"lunch"}') ? "lunch"
        : serialized.includes('"occasion":{"equals":"dinner"}') ? "dinner" : null;
      if (occasion) return { docs: closures.filter((doc) => doc.occasion == null || doc.occasion === occasion) };
      return { docs: closures };
    }
    if (collection === "kiv1_meal_slots") {
      const serialized = JSON.stringify(where);
      if (serialized.includes("orderStatus")) return { docs: options.openSlots ? [{ id: 11 }] : [] };
      return { docs: [{ id: 11 }] };
    }
    if (collection === "kiv1_orders") return { docs: options.orders ? [{ id: 51 }] : [] };
    return { docs: [] };
  });
  return {
    find,
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 42, ...data })),
    delete: vi.fn(async () => closure),
    db: { name: "sqlite" }
  };
}

const request = (path = "", init: RequestInit = {}) => new Request(
  `http://cms.test/api/internal/kiv1/service-closures${path}`,
  { ...init, headers: { "x-kith-inn-v1-operator": token, ...init.headers } }
);
const write = (path: string, method: "POST" | "DELETE", body?: unknown) => request(path, {
  method,
  headers: { "content-type": "application/json", "x-kith-inn-v1-internal": INTERNAL },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createLocalReq.mockResolvedValue({ transactionID: Promise.resolve("tx") });
  mocks.initTransaction.mockResolvedValue(true);
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});
afterEach(() => { process.env = { ...originalEnv }; });

describe("service closure persistence boundary", () => {
  it("lists only the token seller's normalized closures in a valid range", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await GET(request("?from=2026-07-01&to=2026-07-31"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
      id: 41, sellerId: 7, date: "2026-07-27", occasion: null, note: "休息"
    }] });
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_service_closures",
      where: { and: [
        { seller: { equals: 7 } },
        { date: { greater_than_equal: "2026-07-01" } },
        { date: { less_than_equal: "2026-07-31" } }
      ] }
    }));
    expect((await GET(request())).status).toBe(400);
  });

  it("creates a seller-stamped closure inside the shared transaction", async () => {
    const payload = payloadWith({ closures: [] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await POST(write("", "POST", {
      date: "2026-07-27", occasion: "lunch", note: " 午餐休息 "
    }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_service_closures",
      data: { seller: 7, date: "2026-07-27", occasion: "lunch", note: "午餐休息" },
      context: { kiv1ServiceClosureChecked: true },
      req: expect.anything()
    }));
    expect(mocks.commitTransaction).toHaveBeenCalledOnce();
  });

  it("rejects existing closures, open slots, active orders and forged sellers", async () => {
    for (const options of [{}, { closures: [], openSlots: true }, { closures: [], orders: true }]) {
      mocks.getPayload.mockResolvedValue(payloadWith(options));
      expect((await POST(write("", "POST", { date: "2026-07-27" }))).status).toBe(409);
    }
    mocks.getPayload.mockResolvedValue(payloadWith({ closures: [] }));
    expect((await POST(write("", "POST", { date: "2026-07-27", seller: 99 }))).status).toBe(422);
    expect((await POST(request("", { method: "POST" }))).status).toBe(401);
    expect((await POST(request("", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kith-inn-v1-internal": INTERNAL },
      body: "{"
    }))).status).toBe(400);
  });

  it("allows lunch and dinner closures to coexist while preserving whole-day precedence", async () => {
    const payload = payloadWith({
      closures: [{ ...closure, occasion: "dinner" }]
    });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await POST(write("", "POST", { date: "2026-07-27", occasion: "lunch" }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ seller: 7, date: "2026-07-27", occasion: "lunch" })
    }));
  });

  it("deletes only an owned closure under the same date lock", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await DELETE(write("/41", "DELETE"), { params: Promise.resolve({ id: "41" }) })).status).toBe(204);
    expect(payload.delete).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_service_closures", id: "41", req: expect.anything()
    }));

    mocks.getPayload.mockResolvedValue(payloadWith({ closures: [] }));
    expect((await DELETE(write("/99", "DELETE"), { params: Promise.resolve({ id: "99" }) })).status).toBe(404);
  });
});
