import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { GET, POST } from "../src/app/api/internal/kiv1/offerings/route";
import * as detailRoute from "../src/app/api/internal/kiv1/offerings/[id]/route";

const SECRET = "v1-secret";
const originalEnv = { ...process.env };
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);

type PayloadOptions = {
  offerings?: Array<Record<string, unknown>>;
  createError?: unknown;
  updateError?: unknown;
};

function payloadWith(options: PayloadOptions = {}) {
  const find = vi.fn(async ({ collection }: { collection: string }) => {
    if (collection === "kiv1_operators") return { docs: [{ id: 1 }] };
    if (collection === "kiv1_sellers") return { docs: [{ id: 7, status: "active" }] };
    return { docs: options.offerings ?? [] };
  });
  return {
    find,
    create: options.createError
      ? vi.fn(async () => { throw options.createError; })
      : vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 10, ...data })),
    update: options.updateError
      ? vi.fn(async () => { throw options.updateError; })
      : vi.fn(async ({ id, data }: { id: string; data: Record<string, unknown> }) => ({
          id,
          seller: 7,
          name: "旧菜",
          mainIngredient: null,
          category: "veg",
          active: true,
          ...data
        }))
  };
}

function request(path = "", init: RequestInit = {}) {
  return new Request(`http://cms.test/api/internal/kiv1/offerings${path}`, {
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

describe("GET /api/internal/kiv1/offerings", () => {
  it("lists normalized current-seller docs and supports active filters", async () => {
    const payload = payloadWith({ offerings: [{
      id: 10,
      seller: 7,
      name: "番茄牛腩",
      category: "meat",
      active: true
    }] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await GET(request("?active=true"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [{
      id: 10,
      sellerId: 7,
      name: "番茄牛腩",
      mainIngredient: null,
      category: "meat",
      active: true
    }] });
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_offerings",
      where: { and: [{ seller: { equals: 7 } }, { active: { equals: true } }] },
      sort: ["-active", "name"]
    }));

    await GET(request("?active=false"));
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { and: [{ seller: { equals: 7 } }, { active: { equals: false } }] }
    }));
    await GET(request("?active=all"));
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: { seller: { equals: 7 } } }));
  });

  it("defaults to all and rejects invalid active values", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    expect((await GET(request())).status).toBe(200);
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: { seller: { equals: 7 } } }));
    expect((await GET(request("?active=yes"))).status).toBe(400);
  });
});

describe("POST /api/internal/kiv1/offerings", () => {
  it("stamps seller/active and only accepts the write allowlist", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await POST(json("", "POST", {
      name: "番茄牛腩",
      mainIngredient: "牛肉",
      category: "meat"
    }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith({
      collection: "kiv1_offerings",
      data: { seller: 7, name: "番茄牛腩", mainIngredient: "牛肉", category: "meat", active: true },
      overrideAccess: true
    });
    await expect(response.json()).resolves.toMatchObject({ doc: { sellerId: 7, mainIngredient: "牛肉" } });
  });

  it("rejects seller injection/invalid JSON and normalizes same-seller unique conflicts", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await POST(json("", "POST", { seller: 99, name: "菜", category: "veg" }))).status).toBe(422);
    expect((await POST(request("", { method: "POST" }))).status).toBe(400);
    mocks.getPayload.mockResolvedValue(payloadWith({ createError: new Error("duplicate key violates unique constraint") }));
    const conflict = await POST(json("", "POST", { name: "菜", category: "veg" }));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: "offering-name-conflict" });
  });
});

describe("PATCH /api/internal/kiv1/offerings/:id", () => {
  it("updates whitelisted fields including deactivate/restore", async () => {
    const payload = payloadWith({ offerings: [{ id: 10, seller: 7, name: "旧菜", category: "veg", active: true }] });
    mocks.getPayload.mockResolvedValue(payload);
    const response = await detailRoute.PATCH(
      json("/10", "PATCH", { name: "新菜", mainIngredient: null, active: false }),
      { params: Promise.resolve({ id: "10" }) }
    );
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_offerings",
      id: "10",
      data: { name: "新菜", mainIngredient: null, active: false },
      overrideAccess: true
    });
    await expect(response.json()).resolves.toMatchObject({ doc: { id: "10", sellerId: 7, active: false } });
  });

  it("returns the same 404 for missing/cross-seller ids and rejects seller/empty patches", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({ offerings: [] }));
    expect((await detailRoute.PATCH(
      json("/99", "PATCH", { active: false }),
      { params: Promise.resolve({ id: "99" }) }
    )).status).toBe(404);
    mocks.getPayload.mockResolvedValue(payloadWith({ offerings: [{ id: 10, seller: 7 }] }));
    expect((await detailRoute.PATCH(
      json("/10", "PATCH", { seller: 99, active: false }),
      { params: Promise.resolve({ id: "10" }) }
    )).status).toBe(422);
    expect((await detailRoute.PATCH(
      json("/10", "PATCH", {}),
      { params: Promise.resolve({ id: "10" }) }
    )).status).toBe(422);
  });

  it("normalizes rename conflicts and exposes no DELETE handler", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith({
      offerings: [{ id: 10, seller: 7 }],
      updateError: { status: 409 }
    }));
    expect((await detailRoute.PATCH(
      json("/10", "PATCH", { name: "重名菜" }),
      { params: Promise.resolve({ id: "10" }) }
    )).status).toBe(409);
    expect("DELETE" in detailRoute).toBe(false);
  });
});
