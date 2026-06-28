import { afterEach, describe, expect, it, vi } from "vitest";
import { findOperatorByOpenid, findOfferings } from "./client";

const ORIG = process.env.CMS_BASE_URL;
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

/** Mock fetch returning `response` as JSON (a full `Response`), typed as fetch so
 *  `mock.calls` carries the (url, init) args. */
const mockFetch = (response: unknown) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response))),
});

describe("findOperatorByOpenid", () => {
  it("returns the operator with a shallow seller id", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const op = await findOperatorByOpenid(
      "openid-1",
      mockFetch({ docs: [{ id: 1, seller: 7, role: "owner", active: true }] }),
    );
    expect(op).toEqual({ id: 1, sellerId: 7, role: "owner", active: true });
  });

  it("reads the seller id off a populated doc", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const op = await findOperatorByOpenid(
      "openid-1",
      mockFetch({ docs: [{ id: 2, seller: { id: 9, name: "桃子" }, role: "owner", active: true }] }),
    );
    expect(op?.sellerId).toBe(9);
  });

  it("returns null when no operator matches", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    expect(await findOperatorByOpenid("nobody", mockFetch({ docs: [] }))).toBeNull();
  });

  it("throws on a non-2xx cms response (propagates failure, not empty)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const failing = { fetch: vi.fn(async () => new Response("unauthorized", { status: 401 })) };
    await expect(findOperatorByOpenid("x", failing)).rejects.toThrow(/cms operators lookup failed: 401/);
  });

  it("trims a trailing slash on CMS_BASE_URL", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    const deps = mockFetch({ docs: [{ id: 1, seller: 7, role: "owner", active: true }] });
    await findOperatorByOpenid("openid-1", deps);
    expect(deps.fetch.mock.calls[0]?.[0]).toMatch(/^http:\/\/cms\.test\/api\/operators\?/);
  });
});

describe("findOfferings", () => {
  it("returns the offerings list from the cms response", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const offerings = await findOfferings(
      "jwt",
      mockFetch({ docs: [{ id: 1, name: "番茄炒蛋", kind: "component", seller: 7 }] }),
    );
    expect(offerings).toHaveLength(1);
    expect(offerings[0]?.name).toBe("番茄炒蛋");
  });

  it("returns [] when docs is missing", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    expect(await findOfferings("jwt", mockFetch({}))).toEqual([]);
  });

  it("throws on a non-2xx cms response (does not mask as empty menu)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const failing = { fetch: vi.fn(async () => new Response("error", { status: 500 })) };
    await expect(findOfferings("jwt", failing)).rejects.toThrow(/cms offerings lookup failed: 500/);
  });

  it("sends the operator JWT in x-kith-inn-operator", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [] });
    await findOfferings("the-jwt", deps);
    expect(deps.fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-kith-inn-operator": "the-jwt" });
  });
});

describe("cmsBase / global fetch fallback", () => {
  it("throws if CMS_BASE_URL is not configured", async () => {
    delete process.env.CMS_BASE_URL;
    await expect(findOperatorByOpenid("x")).rejects.toThrow(/CMS_BASE_URL/);
    await expect(findOfferings("jwt")).rejects.toThrow(/CMS_BASE_URL/);
  });

  it("uses the global fetch when no deps are provided (findOperatorByOpenid)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      docs: [{ id: 1, seller: 7, role: "owner", active: true }],
    })));
    vi.stubGlobal("fetch", fetchMock);
    const op = await findOperatorByOpenid("openid-1");
    expect(op?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the global fetch when no deps are provided (findOfferings)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ docs: [] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await findOfferings("jwt")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
