import { describe, expect, it, vi } from "vitest";
import type { Offering, OfferingCreate, OfferingUpdate } from "@cfp/kith-inn-v1-shared";
import { issueOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import { CmsOfferingError } from "../lib/cms/offerings";
import { offeringsRoutes, type OfferingsDeps } from "./offerings";

const SECRET = "v1-secret";
const token = await issueOperatorToken({ operatorId: 1, sellerId: 7 }, SECRET);
const existing: Offering = {
  id: 10,
  sellerId: 7,
  name: "番茄牛腩",
  mainIngredient: "牛肉",
  category: "meat",
  active: true
};

function deps(overrides: Partial<OfferingsDeps> = {}): OfferingsDeps {
  return {
    listOfferings: vi.fn(async () => []),
    createOffering: vi.fn(async (_token: string, input: OfferingCreate) => ({ id: 20, sellerId: 7, active: true, mainIngredient: null, ...input } as Offering)),
    updateOffering: vi.fn(async (_token: string, id: string | number, patch: OfferingUpdate) => ({ ...existing, id, ...patch })),
    ...overrides
  };
}

function request(app: ReturnType<typeof offeringsRoutes>, path: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers }
  });
}

describe("merchant offering CRUD", () => {
  it("lists with active filter and protects every route", async () => {
    const listOfferings = vi.fn(async () => [existing]);
    const app = offeringsRoutes(SECRET, deps({ listOfferings }));
    const response = await request(app, "/?active=true");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ docs: [existing] });
    expect(listOfferings).toHaveBeenCalledWith(token, "true");
    expect((await request(app, "/")).status).toBe(200);
    expect(listOfferings).toHaveBeenLastCalledWith(token, "all");
    expect((await app.request("/")).status).toBe(401);
    expect((await request(app, "/?active=yes")).status).toBe(400);
  });

  it("creates/updates/deactivates/restores through PATCH and rejects seller injection", async () => {
    const injected = deps();
    const app = offeringsRoutes(SECRET, injected);
    expect((await request(app, "/", {
      method: "POST",
      body: JSON.stringify({ name: "清炒时蔬", mainIngredient: "青菜", category: "veg" })
    })).status).toBe(201);
    expect(injected.createOffering).toHaveBeenCalledWith(token, { name: "清炒时蔬", mainIngredient: "青菜", category: "veg" });

    expect((await request(app, "/10", { method: "PATCH", body: JSON.stringify({ active: false }) })).status).toBe(200);
    expect((await request(app, "/10", { method: "PATCH", body: JSON.stringify({ active: true }) })).status).toBe(200);
    expect(injected.updateOffering).toHaveBeenNthCalledWith(1, token, "10", { active: false });
    expect(injected.updateOffering).toHaveBeenNthCalledWith(2, token, "10", { active: true });
    expect((await request(app, "/", { method: "POST", body: JSON.stringify({ seller: 99, name: "菜", category: "veg" }) })).status).toBe(422);
    expect((await request(app, "/10", { method: "PATCH", body: JSON.stringify({ seller: 99, active: false }) })).status).toBe(422);
  });

  it("maps CMS statuses without flattening tenant/conflict errors", async () => {
    for (const status of [401, 403, 404, 409, 422, 500]) {
      const app = offeringsRoutes(SECRET, deps({
        createOffering: vi.fn(async () => { throw new CmsOfferingError(status, `cms-${status}`, "失败"); })
      }));
      const response = await request(app, "/", { method: "POST", body: JSON.stringify({ name: "菜", category: "veg" }) });
      expect(response.status).toBe(status === 500 ? 502 : status);
      await expect(response.json()).resolves.toMatchObject({ error: `cms-${status}` });
    }
  });

  it("maps list and patch dependency failures", async () => {
    const listApp = offeringsRoutes(SECRET, deps({
      listOfferings: vi.fn(async () => { throw new Error("offline"); })
    }));
    await expect((await request(listApp, "/")).json()).resolves.toMatchObject({ error: "cms-unavailable" });

    const patchApp = offeringsRoutes(SECRET, deps({
      updateOffering: vi.fn(async () => { throw new Error("offline"); })
    }));
    const response = await request(patchApp, "/10", { method: "PATCH", body: JSON.stringify({ active: false }) });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "cms-unavailable" });
  });

  it("rejects malformed JSON on every write route", async () => {
    const app = offeringsRoutes(SECRET, deps());
    for (const [path, method] of [
      ["/", "POST"],
      ["/10", "PATCH"],
      ["/import/preview", "POST"],
      ["/import/commit", "POST"]
    ] as const) {
      const response = await request(app, path, { method, body: "{" });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "invalid-json" });
    }
  });
});

describe("offering import", () => {
  it("previews without writes", async () => {
    const injected = deps({ listOfferings: vi.fn(async () => [existing]) });
    const app = offeringsRoutes(SECRET, injected);
    const response = await request(app, "/import/preview", {
      method: "POST",
      body: JSON.stringify({ text: "番茄牛腩 牛肉 荤\n新菜 青菜 素\n坏数据" })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ summary: { ready: 1, conflict: 1, invalid: 1 } });
    expect(injected.createOffering).not.toHaveBeenCalled();
    expect(injected.updateOffering).not.toHaveBeenCalled();
  });

  it("reparses/rechecks on commit and returns created/overwritten/skipped/failed per line", async () => {
    const createOffering = vi.fn(async (_token: string, input: OfferingCreate) => {
      if (input.name === "失败菜") throw new CmsOfferingError(409, "offering-name-conflict", "重名");
      return { id: 20, sellerId: 7, active: true, mainIngredient: null, ...input } as Offering;
    });
    const updateOffering = vi.fn(async () => ({ ...existing, mainIngredient: "新牛肉" }));
    const listOfferings = vi.fn(async () => [existing]);
    const injected = deps({ listOfferings, createOffering, updateOffering });
    const response = await request(offeringsRoutes(SECRET, injected), "/import/commit", {
      method: "POST",
      body: JSON.stringify({
        text: "番茄牛腩 新牛肉 荤\n番茄牛腩 牛肉 荤\n新菜 青菜 素\n失败菜 素菜\n坏数据",
        conflicts: [{ line: 1, action: "overwrite" }]
      })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      results: [
        { line: 1, status: "overwritten", id: 10 },
        { line: 2, status: "failed", error: "本次文本内菜名重复" },
        { line: 3, status: "created", id: 20 },
        { line: 4, status: "failed", error: "重名" },
        { line: 5, status: "failed", error: "每行需要菜名和分类" }
      ],
      summary: { created: 1, overwritten: 1, skipped: 0, failed: 3 }
    });
    expect(listOfferings).toHaveBeenCalledOnce();
    expect(updateOffering).toHaveBeenCalledWith(token, 10, { name: "番茄牛腩", mainIngredient: "新牛肉", category: "meat" });
  });

  it("defaults conflicts to skip and rejects more than 50 rows or seller fields", async () => {
    const app = offeringsRoutes(SECRET, deps({ listOfferings: vi.fn(async () => [existing]) }));
    const skipped = await request(app, "/import/commit", {
      method: "POST",
      body: JSON.stringify({ text: "番茄牛腩 牛肉 荤" })
    });
    await expect(skipped.json()).resolves.toMatchObject({
      results: [{ line: 1, status: "skipped", id: 10 }]
    });
    const tooMany = Array.from({ length: 51 }, (_, index) => `菜${index} 素`).join("\n");
    expect((await request(app, "/import/preview", { method: "POST", body: JSON.stringify({ text: tooMany }) })).status).toBe(422);
    expect((await request(app, "/import/preview", { method: "POST", body: JSON.stringify({ text: "菜 素", seller: 99 }) })).status).toBe(422);
    expect((await request(app, "/import/commit", { method: "POST", body: JSON.stringify({ text: "菜 素", seller: 99 }) })).status).toBe(422);
    expect((await request(app, "/import/commit", { method: "POST", body: JSON.stringify({ text: tooMany }) })).status).toBe(422);
  });

  it("maps preview/commit dependency failures and generic row write failures", async () => {
    const unavailable = offeringsRoutes(SECRET, deps({
      listOfferings: vi.fn(async () => { throw new Error("offline"); })
    }));
    for (const path of ["/import/preview", "/import/commit"]) {
      const response = await request(unavailable, path, {
        method: "POST",
        body: JSON.stringify({ text: "新菜 素" })
      });
      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toMatchObject({ error: "cms-unavailable" });
    }

    const rowFailure = offeringsRoutes(SECRET, deps({
      createOffering: vi.fn(async () => { throw new Error("offline"); })
    }));
    await expect((await request(rowFailure, "/import/commit", {
      method: "POST",
      body: JSON.stringify({ text: "新菜 素" })
    })).json()).resolves.toMatchObject({
      results: [{ line: 1, status: "failed", error: "写入失败" }]
    });
  });
});

describe("default dependencies", () => {
  it("wires the real CMS clients", () => {
    expect(() => offeringsRoutes(SECRET)).not.toThrow();
  });
});
