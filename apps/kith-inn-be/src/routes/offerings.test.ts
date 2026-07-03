import type { Offering, OfferingCreate, OfferingUpdate } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { CmsHttpError } from "../lib/cms/orders";
import { offeringsRoutes, type OfferingsDeps } from "./offerings";

const SECRET = "test-secret";

// issueToken is async; resolve once and reuse (all these tests use seller 7).
const token = await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET);

/** Minimal deps with vi.fn mocks; tests override the ones they exercise. */
const mockDeps = (overrides: Partial<OfferingsDeps> = {}): OfferingsDeps => ({
  findOfferings: vi.fn(async (): Promise<Offering[]> => []),
  createOffering: vi.fn(async (_jwt: string, _input: OfferingCreate): Promise<Offering> => ({} as Offering)),
  updateOffering: vi.fn(async (_jwt: string, _id: string | number, _patch: OfferingUpdate): Promise<Offering> => ({} as Offering)),
  deactivateOffering: vi.fn(async () => undefined),
  restoreOffering: vi.fn(async () => undefined),
  ...overrides,
});

describe("GET /offerings", () => {
  it("returns only kind=component offerings (keeps active+inactive for FE partitioning)", async () => {
    const findOfferings = vi.fn(async (): Promise<Offering[]> => [
      { id: 1, name: "番茄炒蛋", kind: "component", category: "veg", active: true, seller: 7 } as Offering,
      { id: 2, name: "已停用菜", kind: "component", category: "veg", active: false, seller: 7 } as Offering,
      { id: 3, name: "套餐", kind: "combo-meal", active: true, seller: 7 } as Offering,
    ]);
    const app = offeringsRoutes(SECRET, { ...mockDeps({ findOfferings }) });
    const res = await app.request("/", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { offerings: Offering[] };
    expect(json.offerings.map((o) => o.id)).toEqual([1, 2]); // combo dropped, inactive kept
  });

  it("401 without an Authorization header", async () => {
    const res = await offeringsRoutes(SECRET, mockDeps()).request("/");
    expect(res.status).toBe(401);
  });

  it("401 with a non-Bearer scheme", async () => {
    const res = await offeringsRoutes(SECRET, mockDeps()).request("/", { headers: { Authorization: "Basic xyz" } });
    expect(res.status).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const res = await offeringsRoutes(SECRET, mockDeps()).request("/", { headers: { Authorization: "Bearer not.a.real.token" } });
    expect(res.status).toBe(401);
  });
});

describe("default deps", () => {
  it("constructing without deps wires the real cms clients (evaluates the default)", () => {
    expect(() => offeringsRoutes(SECRET)).not.toThrow();
  });
});

describe("POST /offerings", () => {
  it("creates with name + mainIngredient + category, returns 201 {offering}", async () => {
    const created: Offering = { id: 14, name: "蒜蓉空心菜", kind: "component", mainIngredient: "青菜", category: "veg", active: true, seller: 7 } as Offering;
    const createOffering = vi.fn(async () => created);
    const app = offeringsRoutes(SECRET, mockDeps({ createOffering }));
    const res = await app.request("/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "蒜蓉空心菜", mainIngredient: "青菜", category: "veg" }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { offering: Offering }).offering).toEqual(created);
    expect(createOffering).toHaveBeenCalledWith(expect.any(String), { name: "蒜蓉空心菜", mainIngredient: "青菜", category: "veg" });
  });

  it("400 when name missing", async () => {
    const app = offeringsRoutes(SECRET, mockDeps());
    const res = await app.request("/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ category: "meat" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 when category missing or invalid", async () => {
    const app = offeringsRoutes(SECRET, mockDeps());
    const noCat = await app.request("/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(noCat.status).toBe(400);
    const badCat = await app.request("/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "X", category: "seafood" }),
    });
    expect(badCat.status).toBe(400);
  });

  it("401 without a token", async () => {
    const res = await offeringsRoutes(SECRET, mockDeps()).request("/", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("400 on empty/non-JSON body", async () => {
    const app = offeringsRoutes(SECRET, mockDeps());
    const res = await app.request("/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /offerings/:id", () => {
  it("updates whitelisted fields, returns 200 {offering}", async () => {
    const updated: Offering = { id: 12, name: "西红柿炒蛋", kind: "component", mainIngredient: "番茄", category: "veg", active: true, seller: 7 } as Offering;
    const updateOffering = vi.fn(async () => updated);
    const app = offeringsRoutes(SECRET, mockDeps({ updateOffering }));
    const res = await app.request("/12", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "西红柿炒蛋", mainIngredient: "番茄" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { offering: Offering }).offering).toEqual(updated);
    expect(updateOffering).toHaveBeenCalledWith(expect.any(String), "12", { name: "西红柿炒蛋", mainIngredient: "番茄" });
  });

  it("400 on empty body (schema refine)", async () => {
    const app = offeringsRoutes(SECRET, mockDeps());
    const res = await app.request("/12", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("400 on non-whitelisted-only body (strips to {} → refine)", async () => {
    const app = offeringsRoutes(SECRET, mockDeps());
    const res = await app.request("/12", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ priceCents: 99 }),
    });
    expect(res.status).toBe(400);
  });

  it("400 on empty/non-JSON body", async () => {
    const app = offeringsRoutes(SECRET, mockDeps());
    const res = await app.request("/12", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" } });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /offerings/:id", () => {
  it("deactivates (soft), returns 200 {ok:true}", async () => {
    const deactivateOffering = vi.fn(async () => undefined);
    const app = offeringsRoutes(SECRET, mockDeps({ deactivateOffering }));
    const res = await app.request("/14", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(deactivateOffering).toHaveBeenCalledWith(expect.any(String), "14");
  });
});

describe("POST /offerings/:id/restore", () => {
  it("reactivates, returns 200 {ok:true}", async () => {
    const restoreOffering = vi.fn(async () => undefined);
    const app = offeringsRoutes(SECRET, mockDeps({ restoreOffering }));
    const res = await app.request("/14/restore", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(restoreOffering).toHaveBeenCalledWith(expect.any(String), "14");
  });

  it("forwards cms 404 (cross-tenant) as 404", async () => {
    const restoreOffering = vi.fn(async () => {
      throw new CmsHttpError(404, "cms offering restore");
    });
    const app = offeringsRoutes(SECRET, mockDeps({ restoreOffering }));
    const res = await app.request("/99/restore", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });
});

describe("cms error forwarding", () => {
  it("POST forwards a generic cms failure as 502", async () => {
    const createOffering = vi.fn(async () => {
      throw new Error("boom");
    });
    const app = offeringsRoutes(SECRET, mockDeps({ createOffering }));
    const res = await app.request("/", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "X", category: "meat" }),
    });
    expect(res.status).toBe(502);
  });

  it("PATCH forwards cms 404 as 404", async () => {
    const updateOffering = vi.fn(async () => {
      throw new CmsHttpError(404, "cms offering update");
    });
    const app = offeringsRoutes(SECRET, mockDeps({ updateOffering }));
    const res = await app.request("/12", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Y" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE forwards cms 404 as 404", async () => {
    const deactivateOffering = vi.fn(async () => {
      throw new CmsHttpError(404, "cms offering deactivate");
    });
    const app = offeringsRoutes(SECRET, mockDeps({ deactivateOffering }));
    const res = await app.request("/14", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });
});
