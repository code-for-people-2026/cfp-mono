import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsAuthError, findCustomerSessionBootstrap, findOperatorMemberships } from "./auth";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const response = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(
  JSON.stringify(body),
  { status, headers: { "content-type": "application/json" } }
));

describe("findOperatorMemberships", () => {
  it("calls the dedicated kiv1 bootstrap with service auth for openid/operatorId", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const fetchMock = response({ memberships: [{ operatorId: 1, sellerId: 7, sellerName: "桃子", active: true }] });
    await expect(findOperatorMemberships({ openid: "wx-id" }, { fetch: fetchMock })).resolves.toHaveLength(1);
    let [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/kiv1/auth/operator-memberships");
    expect(init?.headers).toMatchObject({ "x-kith-inn-v1-internal": "internal", "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ openid: "wx-id" });

    await findOperatorMemberships({ operatorId: 1 }, { fetch: fetchMock });
    [url, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(init?.body as string)).toEqual({ operatorId: 1 });
  });

  it("fails for missing base URL, non-ok status and malformed membership responses", async () => {
    delete process.env.CMS_BASE_URL;
    await expect(findOperatorMemberships({ openid: "x" })).rejects.toThrow(/CMS_BASE_URL/);
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(findOperatorMemberships({ openid: "x" }, { fetch: response({ error: "membership-inactive" }, 403) }))
      .rejects.toEqual(expect.objectContaining({ status: 403, code: "membership-inactive" }));
    await expect(findOperatorMemberships({ openid: "x" }, { fetch: response({ memberships: [{ sellerName: "broken" }] }) }))
      .rejects.toThrow(/invalid cms auth response/);
    for (const invalid of [
      null,
      { operatorId: "", sellerId: 7, sellerName: "桃子", active: true },
      { operatorId: 1, sellerId: 7.5, sellerName: "桃子", active: true },
      { operatorId: 1, sellerId: "seller", sellerName: "", active: true },
      { operatorId: 1, sellerId: "seller", sellerName: "桃子", active: false }
    ]) {
      await expect(findOperatorMemberships({ openid: "x" }, { fetch: response({ memberships: [invalid] }) }))
        .rejects.toThrow(/invalid cms auth response/);
    }
    await expect(findOperatorMemberships({ openid: "x" }, {
      fetch: vi.fn(async () => new Response("not-json", { status: 500 }))
    })).rejects.toMatchObject({ status: 500, code: "cms-auth-failed" });
  });

  it("uses global fetch and represents status/code on CmsAuthError", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    delete process.env.KITH_INN_V1_INTERNAL_TOKEN;
    const fetchMock = response({ memberships: [{ operatorId: "op", sellerId: "seller", sellerName: "桃子", active: true }] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(findOperatorMemberships({ operatorId: 1 })).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({ "x-kith-inn-v1-internal": "" });
    expect(new CmsAuthError(502, "cms-unavailable")).toMatchObject({ status: 502, code: "cms-unavailable" });
  });
});

describe("findCustomerSessionBootstrap", () => {
  const body = {
    seller: { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" },
    batch: {
      id: 31,
      sellerId: 7,
      publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
      title: "一周预订",
      status: "open",
      mealSlotIds: [11],
      createdById: 1
    }
  };

  it("posts the public id with service auth and validates the response", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const fetchMock = response(body);
    await expect(findCustomerSessionBootstrap(body.batch.publicId, { fetch: fetchMock })).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/auth/customer-session",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-kith-inn-v1-internal": "internal" }),
        body: JSON.stringify({ batchPublicId: body.batch.publicId })
      })
    );
  });

  it("preserves CMS failures and rejects malformed success", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(findCustomerSessionBootstrap(body.batch.publicId, {
      fetch: response({ error: "seller-inactive" }, 403)
    })).rejects.toMatchObject({ status: 403, code: "seller-inactive" });
    await expect(findCustomerSessionBootstrap(body.batch.publicId, {
      fetch: response({ seller: {} })
    })).rejects.toThrow(/invalid cms customer bootstrap response/);
    await expect(findCustomerSessionBootstrap(body.batch.publicId, {
      fetch: vi.fn(async () => new Response("bad", { status: 500 }))
    })).rejects.toMatchObject({ code: "cms-auth-failed" });
  });

  it("uses global fetch by default", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = response(body);
    vi.stubGlobal("fetch", fetchMock);
    await expect(findCustomerSessionBootstrap(body.batch.publicId)).resolves.toEqual(body);
  });
});
