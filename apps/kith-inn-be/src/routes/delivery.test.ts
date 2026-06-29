import type { Fulfillment } from "@cfp/kith-inn-shared";
import { describe, expect, it, vi } from "vitest";
import { issueToken } from "../lib/auth/jwt";
import { deliveryRoutes, type DeliveryDeps } from "./delivery";

const SECRET = "test-secret";
const f = (over: Partial<Fulfillment> = {}): Fulfillment =>
  ({ id: 1, orderItem: 1, serviceDate: "2026-06-30", mode: "delivery", status: "pending", addrBuilding: "3A", seller: 7, ...over }) as Fulfillment;
const auth = async () => ({ Authorization: `Bearer ${await issueToken({ operatorId: 1, sellerId: 7, role: "owner" }, SECRET)}` });

describe("GET /delivery", () => {
  it("returns building sort + gap report from cms fulfillments", async () => {
    const listFulfillments = vi.fn<DeliveryDeps["listFulfillments"]>(async () => [
      f({ id: 1, addrBuilding: "3A" }),
      f({ id: 2, addrBuilding: "3A" }),
      f({ id: 3, addrBuilding: "26B", status: "done" }),
    ]);
    const app = deliveryRoutes(SECRET, { listFulfillments });
    const res = await app.request("/?date=2026-06-30&occasion=dinner", { headers: await auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sort: Array<{ building: string; count: number }>; gaps: { totalPending: number } };
    expect(json.sort[0]).toMatchObject({ building: "3A", count: 2 });
    expect(json.gaps.totalPending).toBe(2); // 3A×2 pending; 26B done excluded
    expect(listFulfillments.mock.calls[0]![1]).toMatchObject({ date: "2026-06-30", occasion: "dinner" });
  });

  it("401 without a token", async () => {
    expect((await deliveryRoutes(SECRET, { listFulfillments: vi.fn() }).request("/")).status).toBe(401);
  });
});
