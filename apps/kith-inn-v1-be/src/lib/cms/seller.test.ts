import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsSellerError, getSeller, updateSellerBookingSettings } from "./seller";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS seller client", () => {
  it("gets the token seller through the v1 boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    const seller = { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" as const };
    const deps = response({ doc: seller });
    await expect(getSeller("jwt", deps)).resolves.toEqual(seller);
    expect(deps.fetch).toHaveBeenCalledWith("http://cms.test/api/internal/kiv1/seller", {
      headers: { "x-kith-inn-v1-operator": "jwt" }
    });
  });

  it("updates the default price through the service-authenticated boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const deps = response({ defaultPriceCents: 3200 });
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 }, deps))
      .resolves.toEqual({ defaultPriceCents: 3200 });
    expect(deps.fetch).toHaveBeenCalledWith("http://cms.test/api/internal/kiv1/seller", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-kith-inn-v1-internal": "internal",
        "x-kith-inn-v1-operator": "jwt"
      },
      body: JSON.stringify({ defaultPriceCents: 3200 })
    });
  });

  it("preserves update errors and rejects malformed settings responses", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 },
      response({ error: "seller-inactive", message: "停用" }, 403)))
      .rejects.toMatchObject({ status: 403, code: "seller-inactive", message: "停用" });
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 },
      response({ error: "not-found" }, 404)))
      .rejects.toMatchObject({ status: 404, code: "not-found", message: "商家服务失败" });
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 }, response("bad", 500)))
      .rejects.toMatchObject({ status: 500, code: "cms-seller-failed" });
    const malformed = { fetch: vi.fn<typeof fetch>(async () => new Response("not-json", { status: 500 })) };
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 }, malformed))
      .rejects.toMatchObject({ status: 500, code: "cms-seller-failed" });
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 }, response({})))
      .rejects.toMatchObject({ status: 502, code: "invalid-cms-response" });
  });

  it("preserves CMS errors and rejects malformed success payloads", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(getSeller("jwt", response({ error: "membership-inactive", message: "停用" }, 403)))
      .rejects.toEqual(expect.objectContaining({ status: 403, code: "membership-inactive", message: "停用" }));
    await expect(getSeller("jwt", response({ error: "not-found" }, 404)))
      .rejects.toMatchObject({ status: 404, code: "not-found", message: "商家服务失败" });
    await expect(getSeller("jwt", response({}))).rejects.toBeInstanceOf(CmsSellerError);
    await expect(getSeller("jwt", response(null))).rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("uses stable fallbacks, global fetch and fails without CMS_BASE_URL", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = response({ doc: { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" } }).fetch;
    vi.stubGlobal("fetch", fetchMock);
    await expect(getSeller("jwt")).resolves.toMatchObject({ id: 7 });
    vi.stubGlobal("fetch", response({ defaultPriceCents: 3200 }).fetch);
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 }))
      .resolves.toEqual({ defaultPriceCents: 3200 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 500 })));
    await expect(getSeller("jwt")).rejects.toMatchObject({ code: "cms-seller-failed" });
    delete process.env.CMS_BASE_URL;
    await expect(getSeller("jwt")).rejects.toThrow(/CMS_BASE_URL/);
    await expect(updateSellerBookingSettings("jwt", { defaultPriceCents: 3200 }))
      .rejects.toThrow(/CMS_BASE_URL/);
  });
});
