import { afterEach, describe, expect, it, vi } from "vitest";
import { CmsOfferingError, createOffering, listOfferings, updateOffering } from "./offerings";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const offering = {
  id: 10,
  sellerId: 7,
  name: "番茄牛腩",
  mainIngredient: "牛肉",
  category: "meat" as const,
  active: true
};
const response = (body: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  }))
});

describe("CMS offering client", () => {
  it("lists, creates and patches through the dedicated kiv1 operator boundary", async () => {
    process.env.CMS_BASE_URL = "http://cms.test/";
    const listDeps = response({ docs: [offering] });
    await expect(listOfferings("jwt", "false", listDeps)).resolves.toEqual([offering]);
    expect(listDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/offerings?active=false",
      { headers: { "x-kith-inn-v1-operator": "jwt" } }
    );

    const createDeps = response({ doc: offering }, 201);
    await expect(createOffering("jwt", { name: "番茄牛腩", mainIngredient: "牛肉", category: "meat" }, createDeps))
      .resolves.toEqual(offering);
    expect(createDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/offerings",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "番茄牛腩", mainIngredient: "牛肉", category: "meat" }) })
    );

    const updateDeps = response({ doc: { ...offering, active: false } });
    await expect(updateOffering("jwt", 10, { active: false }, updateDeps)).resolves.toMatchObject({ active: false });
    expect(updateDeps.fetch).toHaveBeenCalledWith(
      "http://cms.test/api/internal/kiv1/offerings/10",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ active: false }) })
    );
  });

  it("preserves CMS error status/code/message and rejects malformed success payloads", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    for (const status of [401, 403, 404, 409, 422, 500]) {
      await expect(listOfferings("jwt", "all", response({ error: `error-${status}`, message: "失败" }, status)))
        .rejects.toEqual(expect.objectContaining({ status, code: `error-${status}`, message: "失败" }));
    }
    await expect(listOfferings("jwt", "all", response({ docs: [{ bad: true }] }))).rejects.toMatchObject({
      status: 502,
      code: "invalid-cms-response"
    });
    await expect(createOffering("jwt", { name: "菜", category: "veg" }, response({}))).rejects.toBeInstanceOf(CmsOfferingError);
  });

  it("uses stable fallbacks for malformed CMS responses", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(listOfferings("jwt", "all", response("bad", 500))).rejects.toMatchObject({
      code: "cms-offering-failed",
      message: "菜品服务失败"
    });
    await expect(listOfferings("jwt", "all", response(null))).rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(listOfferings("jwt", "all", response({}))).rejects.toMatchObject({ code: "invalid-cms-response" });
    await expect(createOffering("jwt", { name: "菜", category: "veg" }, response(null)))
      .rejects.toMatchObject({ code: "invalid-cms-response" });

    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("not-json", { status: 500 }));
    await expect(listOfferings("jwt", "all", { fetch })).rejects.toMatchObject({
      code: "cms-offering-failed",
      message: "菜品服务失败"
    });
  });

  it("fails without CMS_BASE_URL and uses global fetch by default", async () => {
    delete process.env.CMS_BASE_URL;
    await expect(listOfferings("jwt", "all")).rejects.toThrow(/CMS_BASE_URL/);
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = response({ docs: [] }).fetch;
    vi.stubGlobal("fetch", fetchMock);
    await expect(listOfferings("jwt", "all")).resolves.toEqual([]);
  });
});
