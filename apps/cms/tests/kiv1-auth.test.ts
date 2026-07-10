import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueOperatorSelectionToken, issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";

const mocks = vi.hoisted(() => ({ getPayload: vi.fn() }));
vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  getPayload: mocks.getPayload
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import {
  findOwned,
  hasSellerField,
  isUniqueConflict,
  operatorScope,
  servicePayload
} from "../src/lib/kiv1-internal";
import { POST as lookupMemberships } from "../src/app/api/internal/kiv1/auth/operator-memberships/route";

const SECRET = "v1-secret";
const INTERNAL = "v1-internal";
const originalEnv = { ...process.env };

const jsonRequest = (body: unknown, headers: Record<string, string> = {}) => new Request(
  "http://cms.test/api/internal/kiv1/auth/operator-memberships",
  { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }
);

beforeEach(() => {
  vi.resetAllMocks();
  process.env.KITH_INN_V1_JWT_SECRET = SECRET;
  process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("servicePayload", () => {
  it("fails closed for missing configuration, missing header and wrong token", async () => {
    delete process.env.KITH_INN_V1_INTERNAL_TOKEN;
    expect((await servicePayload(jsonRequest({ openid: "x" })) as Response).status).toBe(500);
    process.env.KITH_INN_V1_INTERNAL_TOKEN = INTERNAL;
    expect((await servicePayload(jsonRequest({ openid: "x" })) as Response).status).toBe(401);
    expect((await servicePayload(jsonRequest({ openid: "x" }, { "x-kith-inn-v1-internal": "wrong" })) as Response).status).toBe(401);
    expect(mocks.getPayload).not.toHaveBeenCalled();
  });

  it("returns Payload only for the dedicated v1 internal token", async () => {
    const payload = { find: vi.fn() };
    mocks.getPayload.mockResolvedValue(payload);
    await expect(servicePayload(jsonRequest(
      { openid: "x" },
      { "x-kith-inn-v1-internal": INTERNAL }
    ))).resolves.toBe(payload);
  });
});

describe("membership lookup route", () => {
  it("returns active memberships with active sellers in stable order without openid", async () => {
    const find = vi.fn().mockResolvedValue({
      docs: [
        { id: 3, active: true, wechatOpenid: "secret-openid", seller: { id: 9, name: "周周", status: "active" } },
        { id: 2, active: true, wechatOpenid: "secret-openid", seller: { id: 7, name: "桃子", status: "active" } },
        { id: 4, active: true, wechatOpenid: "secret-openid", seller: { id: 10, name: "暂停", status: "paused" } }
      ]
    });
    mocks.getPayload.mockResolvedValue({ find });
    const response = await lookupMemberships(jsonRequest(
      { openid: "secret-openid" },
      { "x-kith-inn-v1-internal": INTERNAL }
    ));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ memberships: [
      { operatorId: 2, sellerId: 7, sellerName: "桃子", active: true },
      { operatorId: 3, sellerId: 9, sellerName: "周周", active: true }
    ] });
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_operators",
      where: { and: [{ wechatOpenid: { equals: "secret-openid" } }, { active: { equals: true } }] }
    }));
    expect(JSON.stringify(body)).not.toContain("openid");
  });

  it("supports operatorId revalidation and rejects invalid or ambiguous bodies", async () => {
    const find = vi.fn().mockResolvedValue({ docs: [] });
    mocks.getPayload.mockResolvedValue({ find });
    const headers = { "x-kith-inn-v1-internal": INTERNAL };
    expect((await lookupMemberships(jsonRequest({ operatorId: 5 }, headers))).status).toBe(200);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      where: { and: [{ id: { equals: 5 } }, { active: { equals: true } }] }
    }));
    expect((await lookupMemberships(jsonRequest({}, headers))).status).toBe(422);
    expect((await lookupMemberships(jsonRequest({ openid: "x", operatorId: 5 }, headers))).status).toBe(422);
    expect((await lookupMemberships(new Request("http://cms.test", { method: "POST", headers }))).status).toBe(400);
  });
});

describe("operatorScope", () => {
  const payloadWith = (membership = true, seller = true) => ({
    find: vi.fn(async ({ collection }: { collection: string }) => ({
      docs: collection === "kiv1_operators"
        ? (membership ? [{ id: 3 }] : [])
        : (seller ? [{ id: 7, status: "active" }] : [])
    }))
  });

  it("accepts only kind=operator and revalidates active membership plus seller", async () => {
    const payload = payloadWith();
    mocks.getPayload.mockResolvedValue(payload);
    const token = await issueOperatorToken({ operatorId: 3, sellerId: 7 }, SECRET);
    const scope = await operatorScope(new Request("http://cms.test", {
      headers: { "x-kith-inn-v1-operator": token }
    }));
    expect(scope).toMatchObject({ operatorId: 3, sellerId: 7, payload });
    expect(payload.find).toHaveBeenNthCalledWith(1, expect.objectContaining({
      collection: "kiv1_operators",
      where: { and: [
        { id: { equals: 3 } },
        { seller: { equals: 7 } },
        { active: { equals: true } }
      ] }
    }));
    expect(payload.find).toHaveBeenNthCalledWith(2, expect.objectContaining({
      collection: "kiv1_sellers",
      where: { and: [{ id: { equals: 7 } }, { status: { equals: "active" } }] }
    }));
  });

  it("rejects missing secret/header, wrong kind and expiry", async () => {
    delete process.env.KITH_INN_V1_JWT_SECRET;
    expect((await operatorScope(new Request("http://cms.test")) as Response).status).toBe(500);
    process.env.KITH_INN_V1_JWT_SECRET = SECRET;
    expect((await operatorScope(new Request("http://cms.test")) as Response).status).toBe(401);
    const selection = await issueOperatorSelectionToken([
      { operatorId: 3, sellerId: 7 },
      { operatorId: 4, sellerId: 8 }
    ], SECRET);
    expect((await operatorScope(new Request("http://cms.test", {
      headers: { "x-kith-inn-v1-operator": selection }
    })) as Response).status).toBe(401);
    const expired = await issueOperatorToken({ operatorId: 3, sellerId: 7 }, SECRET, 100);
    expect((await operatorScope(new Request("http://cms.test", {
      headers: { "x-kith-inn-v1-operator": expired }
    })) as Response).status).toBe(401);
  });

  it("rejects an inactive membership or paused seller after token issuance", async () => {
    const token = await issueOperatorToken({ operatorId: 3, sellerId: 7 }, SECRET);
    mocks.getPayload.mockResolvedValueOnce(payloadWith(false, true));
    expect((await operatorScope(new Request("http://cms.test", {
      headers: { "x-kith-inn-v1-operator": token }
    })) as Response).status).toBe(403);
    mocks.getPayload.mockResolvedValueOnce(payloadWith(true, false));
    expect((await operatorScope(new Request("http://cms.test", {
      headers: { "x-kith-inn-v1-operator": token }
    })) as Response).status).toBe(403);
  });
});

describe("seller boundary helpers", () => {
  it("detects an explicit seller field and performs seller-scoped finds", async () => {
    expect(hasSellerField({ seller: 9 })).toBe(true);
    expect(hasSellerField({ name: "菜" })).toBe(false);
    expect(hasSellerField(null)).toBe(false);
    const payload = { find: vi.fn().mockResolvedValue({ docs: [] }) };
    await expect(findOwned(payload, "kiv1_offerings", 99, 7)).resolves.toBeUndefined();
    expect(payload.find).toHaveBeenCalledWith(expect.objectContaining({
      collection: "kiv1_offerings",
      where: { and: [{ id: { equals: 99 } }, { seller: { equals: 7 } }] }
    }));
  });

  it("recognizes top-level and nested database uniqueness errors only", () => {
    expect(isUniqueConflict({ status: 409 })).toBe(true);
    expect(isUniqueConflict(new Error("duplicate key"))).toBe(true);
    expect(isUniqueConflict({ cause: { code: "SQLITE_CONSTRAINT_UNIQUE" } })).toBe(true);
    expect(isUniqueConflict({ cause: { code: "23505" } })).toBe(true);
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(isUniqueConflict(cycle)).toBe(false);
    expect(isUniqueConflict(new Error("foreign key constraint"))).toBe(false);
  });
});
