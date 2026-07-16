import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Seller } from "@cfp/kith-inn-shared";
import { OPERATOR_JWT_HEADER } from "./client";
import { CmsHttpError, type OrderUpdatePatch } from "./orders";
import {
  cancelOrderAtomic,
  confirmOrderAtomic,
  createFulfillments,
  createOrderDraft,
  getSeller,
  getOrder,
  listFulfillments,
  listOrders,
  reconcileOrders,
  setFulfillmentsByIds,
  setFulfillmentsByOrders,
  updateOrder,
  upsertSlots,
} from "./orders";

const ORIG = process.env.CMS_BASE_URL;
afterEach(() => {
  process.env.CMS_BASE_URL = ORIG;
  vi.unstubAllGlobals();
});

const mockFetch = (response: unknown, status = 200) => ({
  fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response), { status })),
});

describe("getSeller", () => {
  it("GETs /api/internal/seller with the operator JWT", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const seller: Seller = { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" };
    const deps = mockFetch(seller);
    await expect(getSeller("jwt", deps)).resolves.toEqual(seller);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/seller");
    expect(init?.headers).toMatchObject({ [OPERATOR_JWT_HEADER]: "jwt" });
  });
});

describe("listFulfillments", () => {
  it("GETs /api/internal/fulfillments, unwraps {docs}, builds date+occasion query", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [{ id: 1, order: { id: 3, address: "3A" } }] });
    const fs = await listFulfillments("jwt", { date: "2026-06-30", occasion: "dinner" }, deps);
    expect(fs).toHaveLength(1);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/fulfillments?date=2026-06-30&occasion=dinner");
  });

  it("omits the query string when no filters", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [] });
    expect(await listFulfillments("jwt", {}, deps)).toEqual([]);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/fulfillments");
  });

  it("falls back to [] when docs is absent", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    expect(await listFulfillments("jwt", {}, mockFetch({}))).toEqual([]);
  });
});

describe("getOrder", () => {
  it("GETs /api/internal/orders/:id and returns the normalized detail", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const detail = { id: 90, date: "2026-06-30", occasion: "lunch", status: "draft", customer: { id: 5 }, items: [] };
    const deps = mockFetch(detail);
    await expect(getOrder("jwt", 90, deps)).resolves.toEqual(detail);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders/90");
  });
});

describe("listOrders", () => {
  it("builds a date+occasion+status query string and unwraps {docs}", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ docs: [{ id: 1 }] });
    const orders = await listOrders("jwt", { date: "2026-06-30", occasion: "lunch", status: "confirmed" }, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders?date=2026-06-30&occasion=lunch&status=confirmed");
    expect(orders).toEqual([{ id: 1 }]);
  });

  it("omits the query string when no filters and falls back to [] when docs is absent", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({});
    const orders = await listOrders("jwt", {}, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders");
    expect(orders).toEqual([]);
  });
});

describe("createOrderDraft", () => {
  it("POSTs the draft payload", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ order: { id: 90 }, items: [] });
    await createOrderDraft("jwt", { customer: 5, date: "2026-06-30", occasion: "lunch", source: "chat-paste", items: [], totalCents: 0 }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toMatchObject({ customer: 5, totalCents: 0 });
  });
});

describe("reconcileOrders", () => {
  const body = {
    mode: "snapshot" as const,
    operationKey: "op-1",
    scope: [{ date: "2026-07-13", occasion: "lunch" as const }],
    expectedFingerprint: "fp",
    candidates: [{ customer: 5, date: "2026-07-13", occasion: "lunch" as const, quantity: 2, offering: 9, unitPriceCents: 3000, totalCents: 6000 }],
  };

  it("POSTs one atomic request and returns the stable result", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const result = { ok: true as const, created: [], updated: [{ orderId: 1, beforeQuantity: 1, afterQuantity: 2 }], canceled: [], unchanged: [] };
    const deps = mockFetch(result);
    await expect(reconcileOrders("jwt", body, deps)).resolves.toEqual(result);
    const [url, init] = deps.fetch.mock.calls[0]!;
    expect(String(url)).toBe("http://cms.test/api/internal/orders/reconcile");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(body);
  });

  it("preserves stale-preview for the chat route", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(reconcileOrders("jwt", body, mockFetch({ error: "stale-preview" }, 409))).rejects.toMatchObject({ status: 409, code: "stale-preview" });
  });
});

describe("atomic lifecycle", () => {
  it("POSTs confirm to the order-scoped endpoint", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ slots: [], fulfillments: [], alreadyConfirmed: false });
    await expect(confirmOrderAtomic("jwt", 90, deps)).resolves.toMatchObject({ slots: [], fulfillments: [] });
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders/90/confirm");
    expect(deps.fetch.mock.calls[0]![1]?.method).toBe("POST");
  });

  it("POSTs cancel to the order-scoped endpoint", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ ok: true, alreadyCanceled: false });
    await expect(cancelOrderAtomic("jwt", 90, deps)).resolves.toBeUndefined();
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders/90/cancel");
  });

  it("preserves the stable cms error code", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    await expect(confirmOrderAtomic("jwt", 90, mockFetch({ error: "slot-archived" }, 409))).rejects.toMatchObject({
      status: 409,
      code: "slot-archived",
    });
  });
});

describe("updateOrder", () => {
  it("excludes lifecycle, snapshot, and ownership fields from the patch contract", () => {
    expectTypeOf<Extract<keyof OrderUpdatePatch, "status" | "address" | "customer" | "seller">>().toEqualTypeOf<never>();
    expectTypeOf<NonNullable<OrderUpdatePatch["paymentStatus"]>>().toEqualTypeOf<"unpaid" | "paid">();
  });

  it("PATCHs the order", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ id: 90, paymentStatus: "paid" });
    await updateOrder("jwt", 90, { paymentStatus: "paid", note: "放门口" }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ paymentStatus: "paid", note: "放门口" });
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders/90");
  });
});

describe("upsertSlots", () => {
  it("POSTs the slot array to the upsert endpoint", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch([]);
    await upsertSlots("jwt", [{ date: "2026-06-30", occasion: "lunch", granularity: "occasion" }], deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/service-slots/upsert");
    expect(deps.fetch.mock.calls[0]![1]?.method).toBe("POST");
  });
});

describe("createFulfillments", () => {
  it("POSTs the fulfillment array", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch([{ id: 1 }]);
    await createFulfillments("jwt", [{ order: 90, serviceDate: "2026-06-30", occasion: "lunch", status: "pending" }], deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/fulfillments");
  });
});

describe("setFulfillmentsByIds", () => {
  it("PATCHs the batch update with ids + set", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ ok: true });
    await setFulfillmentsByIds("jwt", [11, 12], { status: "done" }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toMatchObject({ ids: [11, 12], set: { status: "done" } });
  });
});

describe("setFulfillmentsByOrders", () => {
  it("PATCHs the batch update with orderIn + set", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ ok: true });
    await setFulfillmentsByOrders("jwt", [90], { status: "canceled" }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toMatchObject({ orderIn: [90], set: { status: "canceled" } });
  });
});

describe("CmsHttpError", () => {
  it("is thrown with the status on a non-2xx", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = { fetch: vi.fn(async () => new Response("err", { status: 409 })) };
    await expect(getSeller("jwt", deps)).rejects.toMatchObject({ status: 409, name: "CmsHttpError" });
    expect(() => { throw new CmsHttpError(500, "x"); }).toThrow(/500/);
  });

  it("throws if CMS_BASE_URL is unset", async () => {
    delete process.env.CMS_BASE_URL;
    await expect(getSeller("jwt")).rejects.toThrow(/CMS_BASE_URL/);
  });
});

describe("global fetch fallback (no deps)", () => {
  it("uses global fetch when deps are omitted", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 7, name: "桃子", status: "active" })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getSeller("jwt"))?.id).toBe(7);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
