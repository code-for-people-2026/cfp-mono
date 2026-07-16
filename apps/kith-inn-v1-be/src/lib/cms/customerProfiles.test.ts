import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CmsCustomerProfileError,
  createCustomerOwnedProfile,
  createCustomerProfile,
  listCustomerOwnedProfiles,
  touchCustomerOwnedProfile,
  listCustomerProfiles
} from "./customerProfiles";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const profile = {
  id: 21,
  sellerId: 7,
  openid: null,
  displayName: "王阿姨",
  address: "3A-1201",
  active: true
};
const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS customer-profile client", () => {
  it("lists, creates and touches profiles through the customer owner boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    process.env.KITH_INN_V1_INTERNAL_TOKEN = "internal";
    const owned = { ...profile, openid: undefined };
    const listDeps = response({ docs: [owned] });
    await expect(listCustomerOwnedProfiles("customer", listDeps)).resolves.toEqual([owned]);
    expect(listDeps.fetch).toHaveBeenCalledWith("http://cms.test/api/internal/kiv1/customer/profiles", {
      headers: { "x-kith-inn-v1-customer": "customer" }
    });
    const createDeps = response({ doc: owned }, 201);
    const touchDeps = response({ doc: owned });
    await expect(createCustomerOwnedProfile("customer", { displayName: "王阿姨", address: "3A" }, createDeps))
      .resolves.toEqual(owned);
    await expect(touchCustomerOwnedProfile("customer", 21, touchDeps)).resolves.toEqual(owned);
    for (const deps of [createDeps, touchDeps]) expect(deps.fetch).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ headers: expect.objectContaining({
        "x-kith-inn-v1-customer": "customer", "x-kith-inn-v1-internal": "internal"
      }) }));
    await expect(listCustomerOwnedProfiles("customer", response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createCustomerOwnedProfile("customer", { displayName: "王", address: "3A" }, response({ doc: {} })))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    delete process.env.KITH_INN_V1_INTERNAL_TOKEN;
    await expect(touchCustomerOwnedProfile("customer", 21, response({ error: "profile-gone" }, 404)))
      .rejects.toMatchObject({ status: 404, code: "profile-gone" });
  });

  it("lists with an encoded query and creates through the operator boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    const listDeps = response({ docs: [profile] });
    await expect(listCustomerProfiles("jwt", "王 阿姨", listDeps)).resolves.toEqual([profile]);
    expect(listDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/customer-profiles?query=%E7%8E%8B+%E9%98%BF%E5%A7%A8",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );

    const input = { displayName: "王阿姨", address: "3A-1201" };
    const createDeps = response({ doc: profile }, 201);
    await expect(createCustomerProfile("jwt", input, createDeps)).resolves.toEqual(profile);
    expect(createDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/customer-profiles",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) })
    );
  });

  it("preserves errors and rejects malformed list/detail envelopes", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(listCustomerProfiles("jwt", "", response({ error: "membership-inactive", message: "停用" }, 403)))
      .rejects.toMatchObject({ status: 403, code: "membership-inactive", message: "停用" });
    await expect(listCustomerProfiles("jwt", "", response({ error: "membership-inactive" }, 403)))
      .rejects.toMatchObject({ status: 403, code: "membership-inactive", message: "顾客资料服务失败" });
    await expect(listCustomerProfiles("jwt", "", response({ docs: [{}] })))
      .rejects.toMatchObject({ status: 502, code: "invalid-cms-response" });
    await expect(listCustomerProfiles("jwt", "", response({})))
      .rejects.toBeInstanceOf(CmsCustomerProfileError);
    await expect(listCustomerProfiles("jwt", "", response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createCustomerProfile("jwt", { displayName: "王", address: "3A" }, response({})))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createCustomerProfile("jwt", { displayName: "王", address: "3A" }, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });
  });

  it("uses global fetch and stable fallbacks", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    vi.stubGlobal("fetch", response({ docs: [] }).fetch);
    await expect(listCustomerProfiles("jwt", "")).resolves.toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 500 })));
    await expect(listCustomerProfiles("jwt", "")).rejects.toMatchObject({ code: "cms-customer-profile-failed" });
    delete process.env.CMS_BASE_URL;
    await expect(listCustomerProfiles("jwt", "")).rejects.toThrow(/CMS_BASE_URL/);
  });
});
