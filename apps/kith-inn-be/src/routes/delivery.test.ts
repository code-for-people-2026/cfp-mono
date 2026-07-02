import type { Fulfillment } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { deliveryRoutes, type DeliveryDeps } from "./delivery";

const SECRET = "test-secret";
const at = (address: string): Fulfillment["order"] =>
  ({ id: 1, customer: 1, date: "2026-06-30", occasion: "lunch", status: "confirmed", source: "chat-paste", paymentStatus: "unpaid", address, seller: 7 }) as never;
const f = (over: Partial<Fulfillment> = {}): Fulfillment =>
  ({ id: 1, order: at("3A"), serviceDate: "2026-06-30", occasion: "lunch", status: "pending", seller: 7, ...over }) as Fulfillment;
const auth = async () => ({ Authorization: `Bearer ${await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET)}` });
const json = async () => ({ ...(await auth()), "content-type": "application/json" });
/** Minimal deps with both cms methods stubbed (tests override listFulfillments). */
const deps = (listFulfillments: DeliveryDeps["listFulfillments"]): DeliveryDeps => ({
  listFulfillments,
  setFulfillmentsByIds: vi.fn(async () => undefined),
});

describe("GET /delivery", () => {
  it("returns address sort + gap report from cms fulfillments", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [
      f({ id: 1, order: at("3A") }),
      f({ id: 2, order: at("3A") }),
      f({ id: 3, order: at("26B"), status: "done" }),
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

  it("excludes canceled fulfillments from sort + counts (Codex P2)", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [
      f({ id: 1, order: at("3A"), status: "pending" }),
      f({ id: 2, order: at("3A"), status: "canceled" }),
    ]);
    const app = deliveryRoutes(SECRET, deps(listFulfillments));
    const res = await app.request("/", { headers: await auth() });
    const body = (await res.json()) as { sort: Array<{ address: string; count: number }>; gaps: { totalPending: number } };
    expect(body.sort[0]).toMatchObject({ address: "3A", count: 1 }); // canceled dropped from the group
    expect(body.gaps.totalPending).toBe(1);
  });

  it("401 without a token", async () => {
    expect((await deliveryRoutes(SECRET, deps(vi.fn())).request("/")).status).toBe(401);
  });
});

describe("PATCH /fulfillments", () => {
  it("marks exactly the submitted fulfillment ids done (button path, no substring spillover — Codex P1)", async () => {
    const setFulfillmentsByIds = vi.fn(async () => undefined);
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => []);
    const app = deliveryRoutes(SECRET, { listFulfillments, setFulfillmentsByIds });
    const res = await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ ids: [201, 202] }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(2);
    expect(setFulfillmentsByIds).toHaveBeenCalledWith(expect.any(String), [201, 202], { status: "done" });
    expect(listFulfillments).not.toHaveBeenCalled(); // ids path needs no address lookup
  });

  it("marks every open fulfillment whose address contains the fragment done (voice/agent path)", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [
      f({ id: 11, order: at("26B-301") }),
      f({ id: 12, order: at("26B-502") }),
      f({ id: 13, order: at("26B-301"), status: "done" }), // already done → skip
      f({ id: 14, order: at("1D-1201") }),
    ]);
    const setFulfillmentsByIds = vi.fn(async () => undefined);
    const app = deliveryRoutes(SECRET, { listFulfillments, setFulfillmentsByIds });
    const res = await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "26B" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(2); // 11 + 12 (13 done, 14 other building)
    expect(setFulfillmentsByIds).toHaveBeenCalledWith(expect.any(String), [11, 12], { status: "done" });
  });

  it("returns count 0 + no write when nothing matches", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [f({ order: at("1D") })]);
    const setFulfillmentsByIds = vi.fn(async () => undefined);
    const app = deliveryRoutes(SECRET, { listFulfillments, setFulfillmentsByIds });
    const res = await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "99X" }) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { count: number }).count).toBe(0);
    expect(setFulfillmentsByIds).not.toHaveBeenCalled();
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
    const setFulfillmentsByIds = vi.fn(async () => { throw new Error("net"); });
    const app = deliveryRoutes(SECRET, { listFulfillments: vi.fn(async () => [f({ order: at("1D") })]), setFulfillmentsByIds });
    expect((await app.request("/fulfillments", { method: "PATCH", headers: await json(), body: JSON.stringify({ address: "1D" }) })).status).toBe(502);
  });
});
