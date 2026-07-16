import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCustomerToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import * as profileRoutes from "../src/app/api/internal/kiv1/customer/profiles/route";
import { POST as deactivateProfile } from "../src/app/api/internal/kiv1/customer/profiles/[id]/deactivate/route";
import { POST as touchProfile } from "../src/app/api/internal/kiv1/customer/profiles/[id]/touch/route";

const SECRET = "v1-secret";
const INTERNAL = "v1-internal";
const originalEnv = { ...process.env };
const ownerToken = await issueCustomerToken({ sellerId: 7, openid: "wx-owner" }, SECRET);
const neighborToken = await issueCustomerToken({ sellerId: 7, openid: "wx-neighbor" }, SECRET);
const foreignSellerToken = await issueCustomerToken({ sellerId: 8, openid: "wx-owner" }, SECRET);
const operatorToken = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const profiles = [
  { id: 21, seller: 7, openid: "wx-owner", displayName: "王阿姨", address: "3A", active: true },
  { id: 22, seller: 7, openid: "wx-neighbor", displayName: "李叔", address: "3B", active: true },
  { id: 23, seller: 8, openid: "wx-owner", displayName: "周姨", address: "8A", active: true },
  { id: 24, seller: 7, openid: "wx-owner", displayName: "停用资料", address: "3C", active: false }
];

function includes(where: unknown, field: string, value: unknown) {
  const serialized = JSON.stringify(where);
  return serialized.includes(`\"${field}\"`) && (
    serialized.includes(`\"equals\":${JSON.stringify(value)}`)
    || serialized.includes(`\"equals\":${JSON.stringify(String(value))}`)
  );
}

function payloadWith(options: { createError?: unknown; updateError?: unknown } = {}) {
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
    if (collection === "kiv1_sellers") {
      return { docs: [7, 8].filter((id) => includes(where, "id", id)).map((id) => ({ id, status: "active" })) };
    }
    if (collection !== "kiv1_customer_profiles") return { docs: [] };
    return { docs: profiles.filter((doc) =>
      (!JSON.stringify(where).includes("\"id\"") || includes(where, "id", doc.id))
      && includes(where, "seller", doc.seller)
      && includes(where, "openid", doc.openid)
      && (!JSON.stringify(where).includes("\"active\"") || includes(where, "active", doc.active))
    ) };
  });
  const create = options.createError
    ? vi.fn(async () => { throw options.createError; })
    : vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 25, ...data, seller: { id: data.seller } }));
  const update = options.updateError
    ? vi.fn(async () => { throw options.updateError; })
    : vi.fn(async ({ id, data }: { id: string; data: Record<string, unknown> }) => ({
      ...profiles.find((doc) => String(doc.id) === id),
      ...data
    }));
  return { find, create, update };
}

function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string; internal?: boolean } = {}
) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers["x-kith-inn-v1-customer"] = options.token;
  if (options.internal !== false) headers["x-kith-inn-v1-internal"] = INTERNAL;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://cms.test/api/internal/kiv1/customer/profiles${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-16T06:00:00.000Z"));
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...originalEnv };
});

describe("customer profile persistence boundary", () => {
  it("lists only active seller+openid profiles without exposing openid", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const response = await profileRoutes.GET(request("", { token: ownerToken, internal: false }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ docs: [{ id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: true }] });
    expect(JSON.stringify(body)).not.toContain("openid");
    expect(payload.find).toHaveBeenLastCalledWith(expect.objectContaining({
      collection: "kiv1_customer_profiles",
      where: { and: [
        { seller: { equals: 7 } },
        { openid: { equals: "wx-owner" } },
        { active: { equals: true } }
      ] },
      sort: "-lastUsedAt"
    }));
  });

  it("keeps the same openid isolated across sellers and different openids within one seller", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    await expect((await profileRoutes.GET(request("", { token: neighborToken, internal: false }))).json())
      .resolves.toMatchObject({ docs: [{ id: 22 }] });
    await expect((await profileRoutes.GET(request("", { token: foreignSellerToken, internal: false }))).json())
      .resolves.toMatchObject({ docs: [{ id: 23 }] });
  });

  it("requires both auth domains for create and stamps all server-owned fields", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const input = { displayName: " 王阿姨 ", address: " 3A-1201 " };
    expect((await profileRoutes.POST(request("", { method: "POST", body: input, token: ownerToken, internal: false }))).status)
      .toBe(401);
    expect((await profileRoutes.POST(request("", { method: "POST", body: input }))).status).toBe(401);
    const response = await profileRoutes.POST(request("", { method: "POST", body: input, token: ownerToken }));
    expect(response.status).toBe(201);
    expect(payload.create).toHaveBeenCalledWith({
      collection: "kiv1_customer_profiles",
      data: {
        seller: 7,
        openid: "wx-owner",
        displayName: "王阿姨",
        address: "3A-1201",
        active: true,
        lastUsedAt: "2026-07-16T06:00:00.000Z"
      },
      overrideAccess: true
    });
    expect(JSON.stringify(await response.json())).not.toContain("openid");
  });

  it("rejects body injection and non-customer tokens", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    for (const field of ["seller", "openid", "active", "lastUsedAt"]) {
      expect((await profileRoutes.POST(request("", {
        method: "POST",
        body: { displayName: "王阿姨", address: "3A", [field]: "forged" },
        token: ownerToken
      }))).status).toBe(422);
    }
    expect((await profileRoutes.GET(request("", { token: operatorToken, internal: false }))).status).toBe(401);
  });

  it("normalizes malformed JSON and persistence failures", async () => {
    mocks.getPayload.mockResolvedValue(payloadWith());
    expect((await profileRoutes.POST(new Request("http://cms.test/api/internal/kiv1/customer/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kith-inn-v1-customer": ownerToken,
        "x-kith-inn-v1-internal": INTERNAL
      },
      body: "{"
    }))).status).toBe(400);
    mocks.getPayload.mockResolvedValue(payloadWith({ createError: new Error("offline") }));
    expect((await profileRoutes.POST(request("", {
      method: "POST", body: { displayName: "王阿姨", address: "3A" }, token: ownerToken
    }))).status).toBe(500);
    mocks.getPayload.mockResolvedValue(payloadWith({ updateError: new Error("offline") }));
    expect((await touchProfile(request("/21/touch", { method: "POST", token: ownerToken }), {
      params: Promise.resolve({ id: "21" })
    })).status).toBe(500);
    expect((await deactivateProfile(request("/21/deactivate", { method: "POST", token: ownerToken }), {
      params: Promise.resolve({ id: "21" })
    })).status).toBe(500);
  });

  it("touches only an active owner profile and returns 404 across either owner axis", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const context = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await touchProfile(request("/21/touch", { method: "POST", token: ownerToken, internal: false }), context("21"))).status)
      .toBe(401);
    expect((await touchProfile(request("/21/touch", { method: "POST", token: neighborToken }), context("21"))).status)
      .toBe(404);
    expect((await touchProfile(request("/21/touch", { method: "POST", token: foreignSellerToken }), context("21"))).status)
      .toBe(404);
    expect((await touchProfile(request("/24/touch", { method: "POST", token: ownerToken }), context("24"))).status)
      .toBe(404);
    expect((await touchProfile(request("/21/touch", {
      method: "POST", body: { seller: 8 }, token: ownerToken
    }), context("21"))).status).toBe(422);

    const response = await touchProfile(request("/21/touch", { method: "POST", token: ownerToken }), context("21"));
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_customer_profiles",
      id: "21",
      data: { lastUsedAt: "2026-07-16T06:00:00.000Z" },
      overrideAccess: true
    });
    expect(JSON.stringify(await response.json())).not.toContain("openid");
  });

  it("idempotently deactivates only an owner profile without rewriting snapshots", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const context = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await deactivateProfile(request("/21/deactivate", {
      method: "POST", token: ownerToken, internal: false
    }), context("21"))).status).toBe(401);
    expect((await deactivateProfile(request("/21/deactivate", {
      method: "POST", token: neighborToken
    }), context("21"))).status).toBe(404);
    expect((await deactivateProfile(request("/21/deactivate", {
      method: "POST", token: foreignSellerToken
    }), context("21"))).status).toBe(404);
    expect((await deactivateProfile(request("/21/deactivate", {
      method: "POST", body: { active: true }, token: ownerToken
    }), context("21"))).status).toBe(422);

    const response = await deactivateProfile(request("/21/deactivate", {
      method: "POST", token: ownerToken
    }), context("21"));
    expect(response.status).toBe(200);
    expect(payload.update).toHaveBeenCalledWith({
      collection: "kiv1_customer_profiles",
      id: "21",
      data: { active: false },
      overrideAccess: true
    });
    await expect(response.json()).resolves.toEqual({
      doc: { id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: false }
    });

    const repeated = await deactivateProfile(request("/24/deactivate", {
      method: "POST", token: ownerToken
    }), context("24"));
    expect(repeated.status).toBe(200);
    expect(payload.update).toHaveBeenCalledOnce();
    expect(JSON.stringify(await repeated.json())).not.toContain("openid");
  });
});
