import { afterEach, describe, expect, it, vi } from "vitest";
import { createOffering, findOperatorByOpenid, findOfferings } from "./client";

const ORIG = process.env.CMS_BASE_URL;
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

const mockFetch = (response: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status })),
});

const mockStatus = (status: number) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response("err", { status })),
});

describe("findOperatorByOpenid", () => {
  it("returns the operator from cms internal endpoint", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const op = await findOperatorByOpenid(
      "openid-1",
      mockFetch({ id: 1, sellerId: 7, role: "owner", active: true }),
    );
    expect(op).toEqual({ id: 1, sellerId: 7, role: "owner", active: true });
  });

  it("returns null on 404 (no operator matches)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    expect(await findOperatorByOpenid("nobody", mockStatus(404))).toBeNull();
  });

  it("throws on non-2xx (not 404)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(findOperatorByOpenid("x", mockStatus(500))).rejects.toThrow(/cms operators lookup failed: 500/);
  });

  it("POSTs to /api/internal/operator-by-openid with x-internal-token", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    process.env.CMS_INTERNAL_TOKEN = "the-token";
    const deps = mockFetch({ id: 1, sellerId: 7, role: "owner", active: true });
    await findOperatorByOpenid("openid-1", deps);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toContain("/api/internal/operator-by-openid");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-internal-token": "the-token" });
    delete process.env.CMS_INTERNAL_TOKEN;
  });
});

describe("findOfferings", () => {
  it("returns offerings from cms internal endpoint", async () => {
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

  it("sends x-kith-inn-operator + GETs /api/internal/offerings", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [] });
    await findOfferings("the-jwt", deps);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toContain("/api/internal/offerings");
    expect(init?.headers).toMatchObject({ "x-kith-inn-operator": "the-jwt" });
  });

  it("throws on non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(findOfferings("jwt", mockStatus(500))).rejects.toThrow(/cms offerings lookup failed: 500/);
  });
});

describe("createOffering", () => {
  it("POSTs /api/internal/offerings with input + JWT, returns doc", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ doc: { id: 14, name: "蒜蓉粉丝虾" } }, 201);
    const r = await createOffering("jwt", { name: "蒜蓉粉丝虾", mainIngredient: "虾", category: "meat" }, deps);
    expect(r).toEqual({ id: 14, name: "蒜蓉粉丝虾" });
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/offerings");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "蒜蓉粉丝虾", mainIngredient: "虾", category: "meat" });
  });

  it("throws on non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(createOffering("jwt", { name: "X" }, mockStatus(400))).rejects.toThrow(/cms offering create failed: 400/);
  });

  it("uses global fetch when deps omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ doc: { id: 1, name: "X" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOffering("jwt", { name: "X" })).resolves.toEqual({ id: 1, name: "X" });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("cmsBase / global fetch fallback", () => {
  it("throws if CMS_BASE_URL is not configured", async () => {
    delete process.env.CMS_BASE_URL;
    await expect(findOperatorByOpenid("x")).rejects.toThrow(/CMS_BASE_URL/);
    await expect(findOfferings("jwt")).rejects.toThrow(/CMS_BASE_URL/);
  });

  it("uses global fetch when no deps (findOperatorByOpenid)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 1, sellerId: 7, role: "owner", active: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await findOperatorByOpenid("openid-1"))?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses global fetch when no deps (findOfferings)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ docs: [] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await findOfferings("jwt")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
