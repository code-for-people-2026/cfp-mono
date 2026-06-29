import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seller } from "@cfp/kith-inn-shared";
import { OPERATOR_JWT_HEADER } from "./client";
import { CmsHttpError } from "./orders";
import {
  createFulfillments,
  createOrderDraft,
  getSeller,
  getOrder,
  listOrders,
  setFulfillmentsByOrderItems,
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

describe("getOrder", () => {
  it("GETs /api/internal/orders/:id and returns the normalized detail", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const detail = { id: 90, date: "2026-06-30", status: "draft", customer: { id: 5, kind: "regular" }, items: [] };
    const deps = mockFetch(detail);
    await expect(getOrder("jwt", 90, deps)).resolves.toEqual(detail);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders/90");
  });
});

describe("listOrders", () => {
  it("builds a date+status query string", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch([{ id: 1 }]);
    await listOrders("jwt", { date: "2026-06-30", status: "confirmed" }, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders?date=2026-06-30&status=confirmed");
  });

  it("omits the query string when no filters", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch([]);
    await listOrders("jwt", {}, deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/orders");
  });
});

describe("createOrderDraft", () => {
  it("POSTs the draft payload", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ order: { id: 90 }, items: [] });
    await createOrderDraft("jwt", { customer: 5, date: "2026-06-30", source: "chat-paste", items: [], totalCents: 0 }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toMatchObject({ customer: 5, totalCents: 0 });
  });
});

describe("updateOrder", () => {
  it("PATCHs the order", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ id: 90, status: "confirmed" });
    await updateOrder("jwt", 90, { status: "confirmed" }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
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
    await createFulfillments("jwt", [{ orderItem: 201, serviceDate: "2026-06-30", mode: "delivery", status: "pending" }], deps);
    expect(String(deps.fetch.mock.calls[0]![0])).toBe("http://cms.test/api/internal/fulfillments");
  });
});

describe("setFulfillmentsByOrderItems", () => {
  it("PATCHs the batch update with orderItemIn + set", async () => {
    process.env.CMS_BASE_URL = "http://cms.test";
    const deps = mockFetch({ ok: true });
    await setFulfillmentsByOrderItems("jwt", [201, 202], { status: "canceled" }, deps);
    const [, init] = deps.fetch.mock.calls[0]!;
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toMatchObject({ orderItemIn: [201, 202], set: { status: "canceled" } });
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
