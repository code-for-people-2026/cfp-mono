import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, resolveBeBaseUrl, type RequestAdapter } from "./api";
import type { SessionStore } from "../store/session";
import type { CustomerSessionStore } from "../store/customerSession";

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
const customerSessions = (token: string | null = "customer-token"): CustomerSessionStore => ({
  getSession: vi.fn(() => token ? {
    token,
    sellerName: "桃子",
    role: "customer" as const,
    expiresAt: "2027-01-01T00:00:00.000Z"
  } : null),
  setSession: vi.fn(),
  clearSession: vi.fn()
});

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

  it("uses separate customer login and public-view authentication", async () => {
    const publicId = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
    const session = {
      token: "new-customer-token",
      session: { sellerName: "桃子", role: "customer", expiresAt: "2027-01-01T00:00:00.000Z" }
    };
    const view = {
      sellerName: "桃子",
      title: "午餐预订",
      status: "open",
      sharePath: `/pages/booking/index?batch=${publicId}`,
      slots: [{
        date: "2026-07-13",
        occasion: "lunch",
        menuItems: Array.from({ length: 5 }, (_, index) => ({
          nameSnapshot: `菜${index + 1}`,
          mainIngredientSnapshot: index === 0 ? "牛肉" : null,
          categorySnapshot: index < 2 ? "meat" : index < 4 ? "veg" : "soup"
        })),
        unitPriceCents: 3000,
        orderDeadline: "2026-07-12T01:00:00.000Z",
        canBook: true,
        unavailableReason: null
      }]
    };
    const request = vi.fn<RequestAdapter>(async ({ url }) => ({
      statusCode: 200,
      data: url.includes("/public/") ? view : session
    }));
    const customers = customerSessions();
    const client = createApiClient({ request, sessions: sessions(), customerSessions: customers, baseUrl: "http://be.test" });
    await expect(client.customerWxSession("wx-code", publicId)).resolves.toEqual(session);
    await expect(client.customerDevSession("dev-openid", publicId)).resolves.toEqual(session);
    await expect(client.getPublicBookingBatch(publicId)).resolves.toEqual(view);
    await expect(createApiClient({
      request: adapter(200, {
        ...view,
        slots: [{
          ...view.slots[0],
          menuItems: [{
            ...view.slots[0]!.menuItems[0],
            offeringId: "offering-1",
            mainIngredientSnapshot: "牛肉"
          }, ...view.slots[0]!.menuItems.slice(1)]
        }]
      }),
      sessions: sessions(),
      customerSessions: customers
    }).getPublicBookingBatch(publicId)).rejects.toMatchObject({ code: "invalid-api-response" });
    for (const unavailableReason of [
      "booking-batch-closed",
      "meal-slot-closed",
      "order-deadline-passed"
    ] as const) {
      await expect(createApiClient({
        request: adapter(200, {
          ...view,
          slots: [{ ...view.slots[0], canBook: false, unavailableReason }]
        }),
        sessions: sessions(),
        customerSessions: customers
      }).getPublicBookingBatch(publicId)).resolves.toMatchObject({
        slots: [{ canBook: false, unavailableReason }]
      });
    }
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "http://be.test/auth/customer/wx-session",
      data: { code: "wx-code", batchPublicId: publicId },
      header: { "content-type": "application/json" }
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: "http://be.test/auth/customer/dev-session",
      data: { openid: "dev-openid", batchPublicId: publicId }
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      url: `http://be.test/public/booking-batches/${publicId}`,
      header: { "content-type": "application/json", Authorization: "Bearer customer-token" }
    }));
  });

  it("rejects sensitive/malformed customer payloads and clears only customer auth", async () => {
    const publicId = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
    for (const data of [null, { token: "x", session: {} }, {
      token: "x",
      session: { sellerName: "桃子", sellerId: 7, role: "customer", expiresAt: "2027-01-01T00:00:00.000Z" }
    }]) {
      await expect(createApiClient({ request: adapter(200, data), sessions: sessions() })
        .customerDevSession("dev", publicId)).rejects.toMatchObject({ code: "invalid-api-response" });
    }
    for (const data of [null, {}, { sellerName: "桃子", title: "x", status: "open", sharePath: "bad", slots: [] }]) {
      await expect(createApiClient({
        request: adapter(200, data),
        sessions: sessions(),
        customerSessions: customerSessions()
      }).getPublicBookingBatch(publicId)).rejects.toMatchObject({ code: "invalid-api-response" });
    }
    const base = {
      sellerName: "桃子",
      title: "午餐预订",
      status: "open",
      sharePath: `/pages/booking/index?batch=${publicId}`
    };
    const item = {
      nameSnapshot: "菜",
      mainIngredientSnapshot: null,
      categorySnapshot: "veg"
    };
    const slot = {
      date: "2026-07-13",
      occasion: "lunch",
      menuItems: Array.from({ length: 5 }, () => item),
      unitPriceCents: 3000,
      orderDeadline: "2026-07-12T01:00:00.000Z",
      canBook: true,
      unavailableReason: null
    };
    for (const badSlot of [
      null,
      { ...slot, menuItems: null },
      { ...slot, menuItems: Array(5).fill(null) },
      { ...slot, menuItems: [{ ...item, nameSnapshot: "" }, ...Array(4).fill(item)] },
      { ...slot, menuItems: [{ ...item, offeringId: 1 }, ...Array(4).fill(item)] }
    ]) {
      await expect(createApiClient({
        request: adapter(200, { ...base, slots: [badSlot] }),
        sessions: sessions(),
        customerSessions: customerSessions()
      }).getPublicBookingBatch(publicId)).rejects.toMatchObject({ code: "invalid-api-response" });
    }
    const operators = sessions();
    const customers = customerSessions();
    await expect(createApiClient({
      request: adapter(401, { error: "invalid-customer-session", message: "失效" }),
      sessions: operators,
      customerSessions: customers
    }).getPublicBookingBatch(publicId)).rejects.toMatchObject({ status: 401 });
    expect(customers.clearSession).toHaveBeenCalledOnce();
    expect(operators.clearSession).not.toHaveBeenCalled();

    await expect(createApiClient({
      request: adapter(401, { error: "invalid-wechat-code", message: "失效" }),
      sessions: operators,
      customerSessions: customers
    }).customerWxSession("bad-code", publicId)).rejects.toMatchObject({ status: 401 });
    expect(operators.clearSession).not.toHaveBeenCalled();

    await expect(createApiClient({
      request: adapter(403, {}),
      sessions: operators
    }).getPublicBookingBatch(publicId)).rejects.toMatchObject({
      status: 403,
      code: "request-failed",
      message: "请求失败"
    });
    await expect(createApiClient({
      request: adapter(500, {}),
      sessions: operators,
      customerSessions: customerSessions(null)
    }).getPublicBookingBatch(publicId)).rejects.toMatchObject({ status: 500 });
  });

  it("lists owned profiles and submits public-target reservations with customer auth", async () => {
    const profile = { id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: true };
    const target = { date: "2026-07-13", occasion: "lunch" as const };
    const result = { profile, results: [{ target, status: "failed" as const, error: "meal-slot-closed", message: "已关闭" }] };
    const request = vi.fn<RequestAdapter>(async ({ url }) => url.endsWith("/customer/profiles")
      ? { statusCode: 200, data: { docs: [profile] } }
      : { statusCode: 200, data: result });
    const client = createApiClient({ request, sessions: sessions(), customerSessions: customerSessions(), baseUrl: "http://be.test" });
    await expect(client.listOwnedCustomerProfiles()).resolves.toEqual([profile]);
    const input = { batchPublicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11", profile: { customerProfileId: 21 },
      displayName: "王阿姨", address: "3A", items: [{ target, quantity: 2, resubmitCanceled: false }] };
    await expect(client.submitCustomerReservations(input)).resolves.toEqual(result);
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: "http://be.test/customer/profiles",
      method: "GET", header: { "content-type": "application/json", Authorization: "Bearer customer-token" } }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: "http://be.test/customer/reservations",
      method: "POST", data: input }));
    await expect(createApiClient({ request: adapter(200, { docs: [{ ...profile, openid: "leak" }] }), sessions: sessions(),
      customerSessions: customerSessions() }).listOwnedCustomerProfiles()).rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: sessions(), customerSessions: customerSessions() })
      .listOwnedCustomerProfiles()).rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, { ...result, results: [] }), sessions: sessions(),
      customerSessions: customerSessions() }).submitCustomerReservations(input)).rejects.toMatchObject({ code: "invalid-api-response" });
    const order = { id: 31, sellerId: 7, mealSlotId: 11, customerProfileId: 21, status: "draft" as const,
      source: "customer-card" as const, displayName: "王阿姨", address: "3A", quantity: 2, unitPriceCents: 3000,
      totalCents: 6000, paymentStatus: "unpaid" as const, paidAt: null, deliveryStatus: "pending" as const,
      deliveredAt: null, confirmedAt: null, canceledAt: null, note: null };
    for (const status of ["created", "updated", "resubmitted"] as const) await expect(createApiClient({
      request: adapter(200, { profile, results: [{ target, status, doc: order }] }), sessions: sessions(),
      customerSessions: customerSessions()
    }).submitCustomerReservations(input)).resolves.toMatchObject({ results: [{ status }] });
    for (const doc of [{ ...order, status: "confirmed" }, { ...order, source: "manual" },
      { ...order, paymentStatus: "paid" }, { ...order, paidAt: "2026-07-01T00:00:00.000Z" },
      { ...order, deliveryStatus: "done" }, { ...order, deliveredAt: "2026-07-01T00:00:00.000Z" },
      { ...order, confirmedAt: "2026-07-01T00:00:00.000Z" }, { ...order, canceledAt: "2026-07-01T00:00:00.000Z" },
      { ...order, note: "内部" }, { ...order, customerProfileId: 99 }, { ...order, sellerId: 8 }])
      await expect(createApiClient({ request: adapter(200, { profile, results: [{ target, status: "created", doc }] }),
        sessions: sessions(), customerSessions: customerSessions() }).submitCustomerReservations(input))
        .rejects.toMatchObject({ code: "invalid-api-response" });
    for (const data of [null, {}, { profile: { ...profile, active: false }, results: result.results },
      { profile, results: "bad" }, { profile, results: Array(21).fill(result.results[0]) },
      { profile, results: [null] }, { profile, results: [{ target: null }] },
      { profile, results: [{ target: { ...target, date: 1 } }] }, { profile, results: [{ target: { ...target, date: "bad" } }] },
      { profile, results: [{ target: { ...target, occasion: "breakfast" } }] },
      { profile, results: [result.results[0], result.results[0]] },
      { profile, results: [{ target, status: "failed", error: 1, message: "x" }] },
      { profile, results: [{ target, status: "failed", error: "", message: "x" }] },
      { profile, results: [{ target, status: "failed", error: "x", message: 1 }] },
      { profile, results: [{ target, status: "failed", error: "x", message: "" }] },
      { profile, results: [{ ...result.results[0], internal: "leak" }] },
      { profile, results: [{ target, status: "created", doc: order, internal: "leak" }] },
      { profile, results: [{ target, status: "unknown" }] }]) await expect(createApiClient({ request: adapter(200, data),
        sessions: sessions(), customerSessions: customerSessions() }).submitCustomerReservations(input))
      .rejects.toMatchObject({ code: "invalid-api-response" });
  });

  it("manages only validated owned orders and deactivates owned profiles", async () => {
    const batchPublicId = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
    const item = { nameSnapshot: "红烧肉", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" as const };
    const order = { id: 31, target: { date: "2026-07-13", occasion: "lunch" as const },
      menuItems: Array.from({ length: 5 }, () => item), orderStatus: "open" as const,
      orderDeadline: "2026-07-12T01:00:00.000Z", displayName: "王阿姨", address: "3A", quantity: 2,
      unitPriceCents: 3000, totalCents: 6000, status: "draft" as const, paymentStatus: "unpaid" as const,
      paidAt: null, deliveryStatus: "pending" as const, deliveredAt: null, confirmedAt: null, canceledAt: null };
    const profile = { id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: false };
    const request = vi.fn<RequestAdapter>(async ({ url }) => url.endsWith("/deactivate")
      ? { statusCode: 200, data: { doc: profile } }
      : { statusCode: 200, data: url.endsWith("/customer/orders") ? { docs: [order] } : { doc: order } });
    const client = createApiClient({ request, sessions: sessions(), customerSessions: customerSessions(), baseUrl: "http://be.test" });
    await expect(client.listOwnedCustomerOrders()).resolves.toEqual([order]);
    await expect(client.updateOwnedCustomerOrder(31, { batchPublicId, quantity: 3 })).resolves.toEqual(order);
    await expect(client.cancelOwnedCustomerOrder(31, { batchPublicId, confirmed: true })).resolves.toEqual(order);
    await expect(client.deactivateOwnedCustomerProfile(21)).resolves.toEqual(profile);
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: "http://be.test/customer/orders/31",
      method: "PATCH", data: { batchPublicId, quantity: 3 } }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({ url: "http://be.test/customer/orders/31/cancel",
      method: "POST", data: { batchPublicId, confirmed: true } }));
    expect(request).toHaveBeenNthCalledWith(4, expect.objectContaining({ url: "http://be.test/customer/profiles/21/deactivate",
      method: "POST", data: {} }));
    await expect(createApiClient({ request: adapter(200, { docs: [{ ...order, customerOpenid: "leak" }] }),
      sessions: sessions(), customerSessions: customerSessions() }).listOwnedCustomerOrders())
      .rejects.toMatchObject({ code: "invalid-api-response" });
    for (const data of [null, { docs: [], extra: true }]) await expect(createApiClient({ request: adapter(200, data),
      sessions: sessions(), customerSessions: customerSessions() }).listOwnedCustomerOrders())
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, { doc: null }), sessions: sessions(),
      customerSessions: customerSessions() }).updateOwnedCustomerOrder(31, { batchPublicId, quantity: 3 }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: sessions(), customerSessions: customerSessions() })
      .cancelOwnedCustomerOrder(31, { batchPublicId, confirmed: true })).rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, { doc: { ...profile, active: true } }), sessions: sessions(),
      customerSessions: customerSessions() }).deactivateOwnedCustomerProfile(21))
      .rejects.toMatchObject({ code: "invalid-api-response" });
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

  it("sends jielong preview/commit requests and consumes only strict matching responses", async () => {
    const text = "2026-07-20 午餐\n1. 王阿姨 2份";
    const previewHash = "a".repeat(64);
    const preview = {
      previewHash,
      target: { date: "2026-07-20", occasion: "lunch" },
      lines: [{ lineNumber: 2, displayName: "王阿姨", quantity: 2, unitPriceCents: 3000, totalCents: 6000 }],
      totalCents: 6000
    };
    const commit = { previewHash, results: [{ lineNumber: 2, status: "created", orderId: 31 }] };
    const request = vi.fn<RequestAdapter>(async ({ url }) => ({
      statusCode: 200,
      data: url.endsWith("/preview") ? preview : commit
    }));
    const client = createApiClient({ request, sessions: sessions(), baseUrl: "http://be.test" });

    await expect(client.previewJielongImport(text)).resolves.toEqual(preview);
    await expect(client.commitJielongImport({ text, previewHash, confirmed: true })).resolves.toEqual(commit);
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "http://be.test/merchant/jielong/preview",
      method: "POST",
      data: { text }
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: "http://be.test/merchant/jielong/commit",
      method: "POST",
      data: { text, previewHash, confirmed: true }
    }));

    for (const data of [
      { ...preview, sellerId: 7 },
      { ...preview, totalCents: 5999 },
      { ...preview, lines: [preview.lines[0], { ...preview.lines[0], lineNumber: 1 }], totalCents: 12_000 }
    ]) await expect(createApiClient({ request: adapter(200, data), sessions: sessions() }).previewJielongImport(text))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    for (const data of [
      { ...commit, extra: true },
      { ...commit, previewHash: "b".repeat(64) }
    ]) await expect(createApiClient({ request: adapter(200, data), sessions: sessions() }).commitJielongImport({
      text,
      previewHash,
      confirmed: true
    })).rejects.toMatchObject({ code: "invalid-api-response" });
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
      orderDeadline: null,
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

  it("configures meal slots and manages booking batches", async () => {
    const slot = {
      id: 11,
      sellerId: 7,
      date: "2026-07-13",
      occasion: "lunch" as const,
      menuItems: Array.from({ length: 5 }, (_, index) => ({
        offeringId: index + 1,
        nameSnapshot: `菜${index + 1}`,
        mainIngredientSnapshot: null,
        categorySnapshot: index < 2 ? "meat" as const : index < 4 ? "veg" as const : "soup" as const
      })),
      orderStatus: "open" as const,
      orderDeadline: "2026-07-12T01:00:00.000Z",
      priceCents: 2800,
      generatedAt: "2026-07-10T01:00:00.000Z"
    };
    const batch = {
      id: 31,
      sellerId: 7,
      publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
      title: "午餐预订",
      status: "open" as const,
      mealSlotIds: [11],
      createdById: 1
    };
    const share = { title: batch.title, path: `/pages/booking/index?batch=${batch.publicId}` };
    const request = vi.fn<RequestAdapter>(async ({ url, method }) => {
      if (url.includes("booking-config")) return { statusCode: 200, data: { doc: slot } };
      if (url.endsWith("/booking-batches") && method === "POST") return { statusCode: 201, data: { doc: batch, share } };
      if (url.endsWith("/booking-batches/31")) {
        return { statusCode: 200, data: { doc: { ...batch, status: "closed" }, share } };
      }
      return { statusCode: 200, data: { docs: [{ doc: batch, share }] } };
    });
    const client = createApiClient({ request, sessions: sessions(), baseUrl: "http://be.test" });
    const config = { priceCents: 2800, orderDeadline: slot.orderDeadline, orderStatus: "open" as const };
    await expect(client.updateMealSlotBookingConfig(11, config)).resolves.toEqual(slot);
    await expect(client.listBookingBatches("open")).resolves.toEqual([{ doc: batch, share }]);
    await expect(client.listBookingBatches()).resolves.toEqual([{ doc: batch, share }]);
    await expect(client.createBookingBatch({ title: "午餐预订", mealSlotIds: [11] }))
      .resolves.toEqual({ doc: batch, share });
    await expect(client.closeBookingBatch(31)).resolves.toMatchObject({ doc: { status: "closed" }, share });
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: "PATCH",
      url: "http://be.test/merchant/meal-slots/11/booking-config",
      data: config
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: "http://be.test/merchant/booking-batches?status=open"
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({ url: "http://be.test/merchant/booking-batches" }));
    expect(request).toHaveBeenNthCalledWith(4, expect.objectContaining({ method: "POST" }));
    expect(request).toHaveBeenNthCalledWith(5, expect.objectContaining({
      method: "PATCH",
      data: { status: "closed" }
    }));
  });

  it("rejects malformed booking-batch envelopes", async () => {
    const valid = {
      id: 31,
      sellerId: 7,
      publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11",
      title: "午餐预订",
      status: "open",
      mealSlotIds: [11],
      createdById: 1
    };
    const share = { title: valid.title, path: `/pages/booking/index?batch=${valid.publicId}` };
    const invalidDocs = [
      null,
      { ...valid, id: "" },
      { ...valid, sellerId: 1.5 },
      { ...valid, publicId: 1 },
      { ...valid, publicId: "" },
      { ...valid, title: 1 },
      { ...valid, title: "" },
      { ...valid, status: "bad" },
      { ...valid, mealSlotIds: "bad" },
      { ...valid, mealSlotIds: [] },
      { ...valid, mealSlotIds: [null] },
      { ...valid, createdById: null }
    ];
    for (const doc of invalidDocs) {
      await expect(createApiClient({
        request: adapter(200, { docs: [{ doc, share }] }),
        sessions: sessions()
      }).listBookingBatches()).rejects.toMatchObject({ code: "invalid-api-response" });
    }
    for (const data of [
      null,
      {},
      { docs: "bad" },
      { docs: [null] },
      { docs: [{ doc: valid, share: null }] },
      { docs: [{ doc: valid, share: { ...share, title: 1 } }] },
      { docs: [{ doc: valid, share: { ...share, title: "" } }] },
      { docs: [{ doc: valid, share: { ...share, path: 1 } }] },
      { docs: [{ doc: valid, share: { ...share, path: "/wrong" } }] }
    ]) {
      await expect(createApiClient({ request: adapter(200, data), sessions: sessions() }).listBookingBatches())
        .rejects.toMatchObject({ code: "invalid-api-response" });
    }
  });

  it("sends and validates customer-profile and draft-order requests", async () => {
    const profile = {
      id: 21,
      sellerId: 7,
      displayName: "王阿姨",
      address: "3A-1201",
      active: true
    };
    const slot = {
      id: 11,
      sellerId: 7,
      date: "2026-07-13",
      occasion: "lunch" as const,
      menuItems: [
        { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" as const },
        { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" as const },
        { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" as const },
        { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" as const },
        { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" as const }
      ],
      orderStatus: "draft" as const,
      orderDeadline: null,
      priceCents: null,
      generatedAt: "2026-07-10T01:00:00.000Z"
    };
    const order = {
      id: 31,
      sellerId: 7,
      mealSlotId: 11,
      customerProfileId: 21,
      status: "draft" as const,
      source: "manual" as const,
      displayName: "王阿姨",
      address: "3A-1201",
      quantity: 2,
      unitPriceCents: 3000,
      totalCents: 6000,
      paymentStatus: "unpaid" as const,
      paidAt: "2026-07-10T01:00:00.000Z",
      deliveryStatus: "pending" as const,
      deliveredAt: null,
      confirmedAt: null,
      canceledAt: null,
      note: "少辣"
    };
    const nonManualOrders = [
      { ...order, id: 32, source: "customer-card" as const },
      {
        ...order,
        id: 33,
        source: "jielong-import" as const,
        customerProfileId: null,
        address: null
      }
    ];
    const request = vi.fn<RequestAdapter>(async ({ url, method }) => {
      if (url.includes("customer-profiles")) {
        return method === "POST"
          ? { statusCode: 201, data: { doc: profile } }
          : { statusCode: 200, data: { docs: [profile] } };
      }
      if (url.endsWith("/bulk-mark-delivered")) return {
        statusCode: 200,
        data: { results: [
          { id: 31, status: "updated" },
          { id: 32, status: "failed", error: "invalid-order-transition" }
        ] }
      };
      if (url.endsWith("/confirm")) return {
        statusCode: 200,
        data: { doc: { ...order, status: "confirmed", confirmedAt: "2026-07-11T00:00:00.000Z" } }
      };
      if (url.endsWith("/resubmit")) return { statusCode: 200, data: { doc: order } };
      if (method === "POST") return { statusCode: 201, data: { doc: order, profile } };
      if (method === "PATCH") return { statusCode: 200, data: { doc: { ...order, quantity: 3, totalCents: 9000 } } };
      return {
        statusCode: 200,
        data: {
          mealSlot: slot,
          docs: [order, ...nonManualOrders],
          summary: { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 }
        }
      };
    });
    const client = createApiClient({ request, sessions: sessions(), baseUrl: "http://be.test" });
    await expect(client.listCustomerProfiles("王 阿姨")).resolves.toEqual([profile]);
    await expect(client.createCustomerProfile({ displayName: "王阿姨", address: "3A-1201" })).resolves.toEqual(profile);
    await expect(client.listOrders("2026-07-13", "lunch")).resolves.toMatchObject({
      mealSlot: slot,
      docs: [order, ...nonManualOrders]
    });
    await expect(client.createOrder({ mealSlotId: 11, customerProfileId: 21, quantity: 2, note: null }))
      .resolves.toEqual({ doc: order, profile });
    await expect(client.updateOrder(31, { quantity: 3 })).resolves.toMatchObject({ quantity: 3, totalCents: 9000 });
    await expect(client.actOnOrder(31, "confirm")).resolves.toMatchObject({ status: "confirmed" });
    const resubmit = { quantity: 2, displayName: "王阿姨", address: "3A-1201", note: null };
    await expect(client.actOnOrder(31, "resubmit", resubmit)).resolves.toMatchObject({ status: "draft" });
    await expect(client.bulkMarkDelivered([31, 32])).resolves.toEqual([
      { id: 31, status: "updated" },
      { id: 32, status: "failed", error: "invalid-order-transition" }
    ]);
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: "http://be.test/merchant/customer-profiles?query=%E7%8E%8B%20%E9%98%BF%E5%A7%A8"
    }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "POST",
      url: "http://be.test/merchant/customer-profiles"
    }));
    expect(request).toHaveBeenNthCalledWith(3, expect.objectContaining({
      url: "http://be.test/merchant/orders?date=2026-07-13&occasion=lunch"
    }));
    expect(request).toHaveBeenNthCalledWith(4, expect.objectContaining({ method: "POST", data: {
      mealSlotId: 11,
      customerProfileId: 21,
      quantity: 2,
      note: null
    } }));
    expect(request).toHaveBeenNthCalledWith(5, expect.objectContaining({
      method: "PATCH",
      url: "http://be.test/merchant/orders/31",
      data: { quantity: 3 }
    }));
    expect(request).toHaveBeenNthCalledWith(6, expect.objectContaining({
      method: "POST",
      url: "http://be.test/merchant/orders/31/confirm"
    }));
    expect(request).toHaveBeenNthCalledWith(7, expect.objectContaining({
      method: "POST",
      url: "http://be.test/merchant/orders/31/resubmit",
      data: resubmit
    }));
    expect(request).toHaveBeenNthCalledWith(8, expect.objectContaining({
      method: "POST",
      url: "http://be.test/merchant/orders/bulk-mark-delivered",
      data: { ids: [31, 32] }
    }));
    for (const invalid of [
      { ...order, customerProfileId: null, address: null },
      { ...order, source: "customer-card", customerProfileId: null, address: null },
      { ...order, source: "jielong-import", customerProfileId: 21, address: "3A-1201" },
      { ...order, source: "jielong-import", customerProfileId: null, address: "3A-1201" }
    ]) {
      await expect(createApiClient({
        request: adapter(200, {
          mealSlot: slot,
          docs: [invalid],
          summary: { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 }
        }),
        sessions: sessions()
      }).listOrders("2026-07-13", "lunch")).rejects.toMatchObject({ code: "invalid-api-response" });
    }
  });

  it("rejects malformed customer-profile and order envelopes", async () => {
    const store = sessions();
    for (const data of [null, {}, { docs: [{}] }]) {
      await expect(createApiClient({ request: adapter(200, data), sessions: store }).listCustomerProfiles(""))
        .rejects.toMatchObject({ code: "invalid-api-response" });
    }
    await expect(createApiClient({ request: adapter(200, { doc: {} }), sessions: store })
      .createCustomerProfile({ displayName: "王阿姨", address: "3A" }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    for (const data of [null, {}, {
      mealSlot: {},
      docs: [],
      summary: { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 }
    }]) {
      await expect(createApiClient({ request: adapter(200, data), sessions: store }).listOrders("2026-07-13", "lunch"))
        .rejects.toMatchObject({ code: "invalid-api-response" });
    }
    await expect(createApiClient({ request: adapter(200, { doc: {}, profile: {} }), sessions: store })
      .createOrder({ mealSlotId: 11, customerProfileId: 21, quantity: 1, note: null }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: store })
      .createOrder({ mealSlotId: 11, customerProfileId: 21, quantity: 1, note: null }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: store }).updateOrder(31, { quantity: 2 }))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    await expect(createApiClient({ request: adapter(200, null), sessions: store }).actOnOrder(31, "confirm"))
      .rejects.toMatchObject({ code: "invalid-api-response" });
    for (const data of [
      null,
      {},
      { results: [null] },
      { results: [{ id: "", status: "updated" }] },
      { results: [{ id: 31, status: "failed" }] },
      { results: [{ id: 31, status: "failed", error: "" }] },
      { results: [{ id: 31, status: "updated", error: "not-found" }] }
    ]) {
      await expect(createApiClient({ request: adapter(200, data), sessions: store }).bulkMarkDelivered([31]))
        .rejects.toMatchObject({ code: "invalid-api-response" });
    }
  });

  it("rejects invalid order timestamps and summary counters", async () => {
    const slot = {
      id: 11,
      sellerId: 7,
      date: "2026-07-13",
      occasion: "lunch",
      menuItems: [
        { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
        { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
        { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
        { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
        { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
      ],
      orderStatus: "draft",
      orderDeadline: null,
      priceCents: null,
      generatedAt: "2026-07-10T01:00:00.000Z"
    };
    const order = {
      id: 31,
      sellerId: 7,
      mealSlotId: 11,
      customerProfileId: 21,
      status: "draft",
      source: "manual",
      displayName: "王阿姨",
      address: "3A",
      quantity: 1,
      unitPriceCents: 3000,
      totalCents: 3000,
      paymentStatus: "unpaid",
      paidAt: "bad",
      deliveryStatus: "pending",
      deliveredAt: null,
      confirmedAt: null,
      canceledAt: null,
      note: null
    };
    const zero = { confirmedOrders: 0, totalQuantity: 0, unpaid: 0, pendingDelivery: 0 };
    await expect(createApiClient({
      request: adapter(200, { mealSlot: slot, docs: [order], summary: zero }),
      sessions: sessions()
    }).listOrders("2026-07-13", "lunch")).rejects.toMatchObject({ code: "invalid-api-response" });
    for (const summary of [
      { ...zero, confirmedOrders: "0" },
      { ...zero, totalQuantity: 1.5 },
      { ...zero, unpaid: -1 }
    ]) {
      await expect(createApiClient({
        request: adapter(200, { mealSlot: slot, docs: [], summary }),
        sessions: sessions()
      }).listOrders("2026-07-13", "lunch")).rejects.toMatchObject({ code: "invalid-api-response" });
    }
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
    const data = {};
    const request = adapter(422, data);
    const client = createApiClient({ request, sessions: store, baseUrl: "http://be.test" });
    await expect(client.request("/merchant/check", { method: "POST", data: { x: 1 } }))
      .rejects.toEqual(new ApiError(422, "request-failed", "请求失败", data));
    expect(store.clearSession).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      header: { Authorization: "Bearer operator-token", "content-type": "application/json" }
    }));
  });

  it("preserves structured business error data for the menu UI", async () => {
    const data = {
      error: "offering-pool-insufficient",
      message: "菜品池分类不足",
      shortages: [{ category: "soup", required: 1, available: 0 }]
    };
    const client = createApiClient({ request: adapter(422, data), sessions: sessions() });
    await expect(client.generateMenus({
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      replaceExisting: false
    })).rejects.toMatchObject({ code: data.error, message: data.message, data });
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
