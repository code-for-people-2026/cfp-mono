import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_JWT_HEADER } from "./client";
import { CmsHttpError } from "./orders";
import { createOffering, deactivateOffering, restoreOffering, updateOffering } from "./offerings";

const ORIG = process.env.CMS_BASE_URL;
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

const mockFetch = (response: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status })),
});

describe("createOffering", () => {
  it("POSTs /api/internal/offerings with the JWT + M1 whitelist body, returns {doc}.offering", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const doc = { id: 14, name: "蒜蓉空心菜", kind: "component", mainIngredient: "青菜", category: "veg", active: true, seller: 7 };
    const deps = mockFetch({ doc });
    await expect(createOffering("jwt", { name: "蒜蓉空心菜", mainIngredient: "青菜", category: "veg" }, deps)).resolves.toEqual(doc);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/offerings");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt", "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ name: "蒜蓉空心菜", mainIngredient: "青菜", category: "veg" });
  });

  it("throws CmsHttpError on non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(createOffering("jwt", { name: "X", category: "meat" }, mockFetch({ error: "bad" }, 400))).rejects.toBeInstanceOf(CmsHttpError);
  });
});

describe("updateOffering", () => {
  it("PATCHes /api/internal/offerings/:id with the patch, returns {doc}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const doc = { id: 12, name: "西红柿炒蛋", kind: "component", mainIngredient: "番茄", category: "veg", active: true, seller: 7 };
    const deps = mockFetch({ doc });
    await expect(updateOffering("jwt", 12, { name: "西红柿炒蛋", mainIngredient: "番茄" }, deps)).resolves.toEqual(doc);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/offerings/12");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "西红柿炒蛋", mainIngredient: "番茄" });
  });
});

describe("deactivateOffering", () => {
  it("DELETEs /api/internal/offerings/:id with the JWT, resolves void on 200", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ ok: true });
    await expect(deactivateOffering("jwt", 14, deps)).resolves.toBeUndefined();
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/offerings/14");
    expect(init?.method).toBe("DELETE");
    expect(init?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt" });
  });
});

describe("restoreOffering", () => {
  it("POSTs /api/internal/offerings/:id/restore with the JWT, resolves void on 200", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ ok: true });
    await expect(restoreOffering("jwt", 14, deps)).resolves.toBeUndefined();
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/offerings/14/restore");
    expect(init?.method).toBe("POST");
  });

  it("throws CmsHttpError on 404 (cross-tenant)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(restoreOffering("jwt", 99, mockFetch({ error: "not found" }, 404))).rejects.toBeInstanceOf(CmsHttpError);
  });
});

describe("global fetch fallback (no deps)", () => {
  it("uses global fetch when deps are omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ doc: { id: 14, name: "X", category: "meat" } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOffering("jwt", { name: "X", category: "meat" })).resolves.toMatchObject({ id: 14 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
