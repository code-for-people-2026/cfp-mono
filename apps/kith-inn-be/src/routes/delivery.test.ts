import type { Fulfillment } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { deliveryRoutes, type DeliveryDeps } from "./delivery";

const SECRET = "test-secret";
const at = (id: number, address: string): Fulfillment["orderItem"] => ({ id, order: { id: 1, address } }) as never;
const f = (over: Partial<Fulfillment> = {}): Fulfillment =>
  ({ id: 1, orderItem: at(1, "3A"), serviceDate: "2026-06-30", mode: "delivery", status: "pending", seller: 7, ...over }) as Fulfillment;
const auth = async () => ({ Authorization: `Bearer ${await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET)}` });
const json = async () => ({ ...(await auth()), "content-type": "application/json" });
/** Minimal deps with both cms methods stubbed (tests override listFulfillments). */
const deps = (listFulfillments: DeliveryDeps["listFulfillments"]): DeliveryDeps => ({
  listFulfillments,
  setFulfillmentsByOrderItems: vi.fn(async () => undefined),
});

describe("GET /delivery", () => {
  it("returns address sort + gap report from cms fulfillments", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [
      f({ id: 1, orderItem: at(101, "3A") }),
      f({ id: 2, orderItem: at(102, "3A") }),
      f({ id: 3, orderItem: at(103, "26B"), status: "done" }),
    ]);
    const app = deliveryRoutes(SECRET, deps(listFulfillments));
    const res = await app.request("/?date=2026-06-30&occasion=dinner", { headers: await auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sort: Array<{ address: string; count: number }>; gaps: { totalPending: number } };
    expect(body.sort[0]).toMatchObject({ address: "3A", count: 2 });
    expect(body.gaps.totalPending).toBe(2); // 3A×2 pending; 26B done excluded
    expect(listFulfillments.mock.calls[0]![1]).toMatchObject({ date: "2026-06-30", occasion: "dinner" });
  });

  it("passes undefined filters when no query params", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => []);
    const app = deliveryRoutes(SECRET, deps(listFulfillments));
    const res = await app.request("/", { headers: await auth() });
    expect(res.status).toBe(200);
    expect(listFulfillments.mock.calls[0]![1]).toEqual({ date: undefined, occasion: undefined });
  });

  it("401 without a token", async () => {
    expect((await deliveryRoutes(SECRET, deps(vi.fn())).request("/")).status).toBe(401);
  });
});

describe("PATCH /fulfillments", () => {
  it("marks every open fulfillment whose address contains the fragment done", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [
      f({ id: 11, orderItem: at(201, "26B-301") }),
      f({ id: 12, orderItem: at(202, "26B-502") }),
      f({ id: 13, orderItem: at(203, "26B-301"), status: "done" }), // already done → skip
      f({ id: 14, orderItem: at(204, "1D-1201") }),
    ]);
    const setFulfillmentsByOrderItems = vi.fn(async () => undefined);
    const app = deliveryRoutes(SECRET, { listFulfillments, setFulfillmentsByOrderItems });
    const res = await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "26B" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(2); // 201 + 202 (203 done, 204 other building)
    expect(setFulfillmentsByOrderItems).toHaveBeenCalledWith(expect.any(String), [201, 202], { status: "done" });
  });

  it("returns count 0 + no write when nothing matches", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [f({ orderItem: at(201, "1D") })]);
    const setFulfillmentsByOrderItems = vi.fn(async () => undefined);
    const app = deliveryRoutes(SECRET, { listFulfillments, setFulfillmentsByOrderItems });
    const res = await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "99X" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(0);
    expect(setFulfillmentsByOrderItems).not.toHaveBeenCalled();
  });

  it("400 when address is missing/blank (blank would otherwise mark ALL)", async () => {
    const app = deliveryRoutes(SECRET, deps(vi.fn()));
    expect((await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({}) })).status).toBe(400);
    expect((await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "   " }) })).status).toBe(400);
  });

  it("400 on a non-JSON body (json parse falls back to null)", async () => {
    const app = deliveryRoutes(SECRET, deps(vi.fn()));
    expect((await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: "not-json" })).status).toBe(400);
  });

  it("401 without a token", async () => {
    expect((await deliveryRoutes(SECRET, deps(vi.fn())).request("/fulfillments", { method: "PATCH", body: JSON.stringify({ address: "1D" }) })).status).toBe(401);
  });

  it("502 when the cms write throws", async () => {
    const setFulfillmentsByOrderItems = vi.fn(async () => { throw new Error("net"); });
    const app = deliveryRoutes(SECRET, { listFulfillments: vi.fn(async () => [f({ orderItem: at(201, "1D") })]), setFulfillmentsByOrderItems });
    expect((await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "1D" }) })).status).toBe(502);
  });
});
