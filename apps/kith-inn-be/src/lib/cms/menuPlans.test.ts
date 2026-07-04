import { afterEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_JWT_HEADER } from "./client";
import { CmsHttpError } from "./orders";
import { getMenuPlan, listMenuPlans, patchMenuPlan, upsertMenuPlans } from "./menuPlans";

const ORIG = process.env.CMS_BASE_URL;
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

const mockFetch = (response: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status })),
});

describe("listMenuPlans", () => {
  it("GETs /api/internal/menu-plans?from=&to= with the JWT, unwraps {docs}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [{ id: 501, status: "draft" }] });
    await expect(listMenuPlans("jwt", { from: "2026-07-06", to: "2026-07-10" }, deps)).resolves.toEqual([{ id: 501, status: "draft" }]);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/menu-plans?from=2026-07-06&to=2026-07-10");
    expect(init?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt" });
  });

  it("falls back to [] when docs absent", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    expect(await listMenuPlans("jwt", { from: "x", to: "y" }, mockFetch({}))).toEqual([]);
  });
});

describe("getMenuPlan", () => {
  it("GETs /api/internal/menu-plans/:id and returns {doc}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ doc: { id: 501, status: "draft" } });
    await expect(getMenuPlan("jwt", 501, deps)).resolves.toEqual({ id: 501, status: "draft" });
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/menu-plans/501");
  });

  it("throws CmsHttpError on 404 (cross-tenant)", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(getMenuPlan("jwt", 99, mockFetch({ error: "not found" }, 404))).rejects.toBeInstanceOf(CmsHttpError);
  });
});

describe("upsertMenuPlans", () => {
  it("POSTs /api/internal/menu-plans/upsert with items + JWT, unwraps {docs}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [{ id: 501 }] });
    const items = [{ date: "2026-07-08", occasion: "lunch", offerings: [12, 13], status: "draft" }];
    await expect(upsertMenuPlans("jwt", items, deps)).resolves.toEqual([{ id: 501 }]);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/menu-plans/upsert");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(items);
    expect(init?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt", "content-type": "application/json" });
  });

  it("falls back to [] when docs absent", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    expect(await upsertMenuPlans("jwt", [], mockFetch({}))).toEqual([]);
  });
});

describe("patchMenuPlan", () => {
  it("PATCHes /api/internal/menu-plans/:id with the patch, returns {doc}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ doc: { id: 501, status: "published", publishText: "【街坊味】…" } });
    await expect(patchMenuPlan("jwt", 501, { status: "published", publishText: "【街坊味】…" }, deps)).resolves.toMatchObject({ status: "published" });
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/menu-plans/501");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ status: "published", publishText: "【街坊味】…" });
  });

  it("forwards publishText:null (clear) in body", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ doc: { id: 501 } });
    await patchMenuPlan("jwt", 501, { offerings: [12], publishText: null }, deps);
    expect(JSON.parse(deps.fetch.mock.calls[0]![1]!.body as string)).toEqual({ offerings: [12], publishText: null });
  });
});

describe("global fetch fallback (no deps)", () => {
  it("uses global fetch when deps are omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ docs: [{ id: 501 }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listMenuPlans("jwt", { from: "x", to: "y" })).resolves.toEqual([{ id: 501 }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
