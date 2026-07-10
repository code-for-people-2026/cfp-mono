import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, resolveBeBaseUrl, type RequestAdapter } from "./api";
import type { SessionStore } from "../store/session";

const sessions = (token: string | null = "operator-token"): SessionStore => ({
  getSession: vi.fn(() => token ? {
    token,
    operatorId: 1,
    sellerId: 7,
    sellerName: "桃子",
    role: "operator" as const,
    expiresAt: "2027-01-01T00:00:00.000Z"
  } : null),
  setSession: vi.fn(),
  clearSession: vi.fn()
});

const adapter = (statusCode: number, data: unknown): RequestAdapter => vi.fn(async () => ({ statusCode, data }));

describe("API client", () => {
  it("calls all auth endpoints without leaking an existing bearer token", async () => {
    const request = adapter(200, {
      status: "authenticated",
      token: "new-token",
      session: {
        operatorId: 1,
        sellerId: 7,
        sellerName: "桃子",
        role: "operator",
        expiresAt: "2027-01-01T00:00:00.000Z"
      }
    });
    const client = createApiClient({ request, sessions: sessions(), baseUrl: "http://be.test/" });
    await client.wxLogin("wx-code");
    await client.devLogin("seed-openid");
    await client.selectSeller("selection", 8);
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "http://be.test/auth/operator/wx-login",
      method: "POST",
      data: { code: "wx-code" },
      header: { "content-type": "application/json" }
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: "http://be.test/auth/operator/dev-login",
      data: { openid: "seed-openid" }
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      url: "http://be.test/auth/operator/select-seller",
      data: { selectionToken: "selection", sellerId: 8 }
    }));
  });

  it("validates seller selection and rejects malformed login payloads", async () => {
    const store = sessions();
    const selection = {
      status: "seller-selection-required",
      selectionToken: "selection-token",
      sellers: [
        { sellerId: 7, sellerName: "桃子" },
        { sellerId: "8", sellerName: "李子" }
      ]
    };
    await expect(createApiClient({ request: adapter(200, selection), sessions: store }).devLogin("openid"))
      .resolves.toEqual(selection);

    const invalid = [
      null,
      { status: "authenticated", token: "token", session: {} },
      { status: "seller-selection-required", selectionToken: 1, sellers: [] },
      { status: "seller-selection-required", selectionToken: "x", sellers: "bad" },
      { status: "seller-selection-required", selectionToken: "x", sellers: [{ sellerId: 7, sellerName: "桃子" }] },
      { status: "seller-selection-required", selectionToken: "x", sellers: [null, { sellerId: 8, sellerName: "李子" }] },
      { status: "seller-selection-required", selectionToken: "x", sellers: [{ sellerId: 1.5, sellerName: "桃子" }, { sellerId: 8, sellerName: "李子" }] },
      { status: "seller-selection-required", selectionToken: "x", sellers: [{ sellerId: 7, sellerName: 1 }, { sellerId: 8, sellerName: "李子" }] },
      { status: "seller-selection-required", selectionToken: "x", sellers: [{ sellerId: 7, sellerName: "" }, { sellerId: 8, sellerName: "李子" }] }
    ];
    for (const data of invalid) {
      await expect(createApiClient({ request: adapter(200, data), sessions: store }).devLogin("openid"))
        .rejects.toMatchObject({ code: "invalid-api-response" });
    }
  });

  it("sends and validates offering CRUD/import requests", async () => {
    const offering = { id: 1, sellerId: 7, name: "菜", mainIngredient: "青菜", category: "veg", active: true };
    const request = vi.fn<RequestAdapter>(async ({ url }) => {
      if (url.endsWith("/import/preview")) return {
        statusCode: 200,
        data: { rows: [{ line: 1, raw: "菜 素", parsed: { name: "菜", mainIngredient: null, category: "veg" }, status: "ready", defaultAction: "create" }], summary: { ready: 1, conflict: 0, invalid: 0 } }
      };
      if (url.endsWith("/import/commit")) return {
        statusCode: 200,
        data: { results: [{ line: 1, status: "created", id: 1 }], summary: { created: 1, overwritten: 0, skipped: 0, failed: 0 } }
      };
      return url.includes("/merchant/offerings/1")
        ? { statusCode: 200, data: { doc: { ...offering, active: false } } }
        : { statusCode: 200, data: url.endsWith("?active=all") ? { docs: [offering] } : { doc: offering } };
    });
    const client = createApiClient({ request, sessions: sessions(), baseUrl: "http://be.test" });
    await expect(client.listOfferings("all")).resolves.toEqual([offering]);
    await expect(client.createOffering({ name: "菜", category: "veg" })).resolves.toEqual(offering);
    await expect(client.updateOffering(1, { active: false })).resolves.toMatchObject({ active: false });
    await expect(client.previewOfferingImport("菜 素")).resolves.toMatchObject({ summary: { ready: 1 } });
    await expect(client.commitOfferingImport({ text: "菜 素", conflicts: [] })).resolves.toMatchObject({ summary: { created: 1 } });
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: "http://be.test/merchant/offerings?active=all" }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "POST", data: { name: "菜", category: "veg" } }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({ method: "PATCH", url: "http://be.test/merchant/offerings/1" }));
    expect(request).toHaveBeenNthCalledWith(4, expect.objectContaining({ url: "http://be.test/merchant/offerings/import/preview" }));
    expect(request).toHaveBeenNthCalledWith(5, expect.objectContaining({ url: "http://be.test/merchant/offerings/import/commit" }));
  });

  it("rejects malformed offering envelopes and covers the default all filter", async () => {
    const store = sessions();
    const valid = { statusCode: 200, data: { docs: [] } };
    const client = createApiClient({ request: vi.fn(async () => valid), sessions: store });
    await expect(client.listOfferings()).resolves.toEqual([]);
    for (const data of [null, "bad", {}]) {
      const malformed = createApiClient({ request: adapter(200, data), sessions: store });
      await expect(malformed.listOfferings()).rejects.toMatchObject({ code: "invalid-api-response" });
      await expect(malformed.createOffering({ name: "菜", category: "veg" })).rejects.toThrow();
    }

    const malformedOfferings = [
      null,
      { id: "", sellerId: 7, name: "菜", mainIngredient: null, category: "veg", active: true },
      { id: 1, sellerId: 1.5, name: "菜", mainIngredient: null, category: "veg", active: true },
      { id: 1, sellerId: 7, name: 1, mainIngredient: null, category: "veg", active: true },
      { id: 1, sellerId: 7, name: "", mainIngredient: null, category: "veg", active: true },
      { id: 1, sellerId: 7, name: "菜", mainIngredient: 1, category: "veg", active: true },
      { id: 1, sellerId: 7, name: "菜", mainIngredient: null, category: "other", active: true },
      { id: 1, sellerId: 7, name: "菜", mainIngredient: null, category: "veg", active: "yes" }
    ];
    for (const offering of malformedOfferings) {
      const malformed = createApiClient({ request: adapter(200, { docs: [offering] }), sessions: store });
      await expect(malformed.listOfferings()).rejects.toMatchObject({ code: "invalid-api-response" });
    }

    await expect(createApiClient({ request: adapter(200, {}), sessions: store }).previewOfferingImport("菜 素"))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, {}), sessions: store }).commitOfferingImport({ text: "菜 素", conflicts: [] }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
  });

  it("sends and validates meal-slot list/generate/swap requests", async () => {
    const menuItems = [
      { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
      { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
      { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
      { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
      { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
    ];
    const slot = {
      id: 11,
      sellerId: 7,
      date: "2026-07-13",
      occasion: "lunch",
      menuItems,
      orderStatus: "draft",
      priceCents: null,
      generatedAt: "2026-07-10T01:00:00.000Z"
    };
    const request = vi.fn<RequestAdapter>(async ({ url }) => {
      if (url.includes("generate-menus")) return { statusCode: 200, data: { docs: [slot], relaxedRules: ["recent-offering"] } };
      if (url.includes("swap-menu-item")) return { statusCode: 200, data: { doc: slot, relaxedRules: [] } };
      return { statusCode: 200, data: { docs: [slot] } };
    });
    const client = createApiClient({ request, sessions: sessions(), baseUrl: "http://be.test" });
    await expect(client.listMealSlots("2026-07-01", "2026-07-31")).resolves.toEqual([slot]);
    await expect(client.generateMenus({
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      replaceExisting: false
    })).resolves.toMatchObject({ docs: [slot], relaxedRules: ["recent-offering"] });
    await expect(client.swapMenuItem(11, 5)).resolves.toMatchObject({ doc: slot, relaxedRules: [] });
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "http://be.test/merchant/meal-slots?from=2026-07-01&to=2026-07-31"
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "POST",
      url: "http://be.test/merchant/meal-slots/generate-menus",
      data: { targets: [{ date: "2026-07-13", occasion: "lunch" }], replaceExisting: false }
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: "POST",
      url: "http://be.test/merchant/meal-slots/11/swap-menu-item",
      data: { offeringId: 5 }
    }));
  });

  it("rejects malformed meal-slot envelopes", async () => {
    const store = sessions();
    for (const data of [null, {}, { docs: [{}] }]) {
      await expect(createApiClient({ request: adapter(200, data), sessions: store }).listMealSlots("2026-07-01", "2026-07-31"))
        .rejects.toMatchObject({ code: "invalid-api-response" });
    }
    await expect(createApiClient({ request: adapter(200, { docs: [], relaxedRules: ["unknown"] }), sessions: store })
      .generateMenus({ targets: [{ date: "2026-07-13", occasion: "lunch" }], replaceExisting: false }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: store })
      .generateMenus({ targets: [{ date: "2026-07-13", occasion: "lunch" }], replaceExisting: false }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, {}), sessions: store }).swapMenuItem(11, 5))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: store }).swapMenuItem(11, 5))
      .rejects.toMatchObject({ code: "invalid-api-response" });
  });

  it("sends bearer for merchant calls and clears session on 401/403", async () => {
    for (const status of [401, 403]) {
      const store = sessions();
      const onAuthFailure = vi.fn();
      const client = createApiClient({
        request: adapter(status, { error: status === 401 ? "unauthorized" : "membership-inactive", message: "身份失效" }),
        sessions: store,
        baseUrl: "http://be.test",
        onAuthFailure
      });
      await expect(client.request("/merchant/check")).rejects.toEqual(expect.objectContaining({ status, message: "身份失效" }));
      expect(store.clearSession).toHaveBeenCalledOnce();
      expect(onAuthFailure).toHaveBeenCalledWith(status);
    }
  });

  it("keeps session for business errors and uses stable fallbacks", async () => {
    const store = sessions();
    const request = adapter(422, {});
    const client = createApiClient({ request, sessions: store, baseUrl: "http://be.test" });
    await expect(client.request("/merchant/check", { method: "POST", data: { x: 1 } }))
      .rejects.toEqual(new ApiError(422, "request-failed", "请求失败"));
    expect(store.clearSession).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      header: { Authorization: "Bearer operator-token", "content-type": "application/json" }
    }));
  });

  it("normalizes the base URL and works without a token or auth callback", async () => {
    expect(resolveBeBaseUrl(" http://localhost:3311/// ")).toBe("http://localhost:3311");
    expect(resolveBeBaseUrl()).toBe("http://localhost:3311");
    const request = adapter(200, { ok: true });
    const client = createApiClient({ request, sessions: sessions(null) });
    await expect(client.request<{ ok: boolean }>("/merchant/check")).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ header: { "content-type": "application/json" } }));
  });
});
