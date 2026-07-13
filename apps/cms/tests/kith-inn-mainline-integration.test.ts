import { fingerprintActiveOrders } from "@cfp/kith-inn-shared/orderReconciliation";
import { resetSeedData } from "@cfp/kith-inn-payload/seed";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Payload } from "payload";
import { runProjectSeed } from "../seed/run";
import * as customers from "../src/app/api/internal/customers/route";
import * as fulfillments from "../src/app/api/internal/fulfillments/route";
import * as menuPlans from "../src/app/api/internal/menu-plans/route";
import * as menuPlanDetail from "../src/app/api/internal/menu-plans/[id]/route";
import * as menuPlanUpsert from "../src/app/api/internal/menu-plans/upsert/route";
import * as orderConfirm from "../src/app/api/internal/orders/[id]/confirm/route";
import * as orderDetail from "../src/app/api/internal/orders/[id]/route";
import * as orderReconcile from "../src/app/api/internal/orders/reconcile/route";
import * as orders from "../src/app/api/internal/orders/route";
import * as serviceSlots from "../src/app/api/internal/service-slots/upsert/route";
import {
  hasMainlinePostgres,
  routeRequest,
  startKithInnMainline,
  type MainlineTenant,
} from "./helpers/kithInnMainline";

type Id = string | number;
type JsonDoc = { id: Id; seller?: Id | { id: Id }; status?: string };

const json = async <T>(response: Response, status = 200): Promise<T> => {
  expect(response.status).toBe(status);
  return response.json() as Promise<T>;
};

const params = (id: Id) => ({ params: Promise.resolve({ id: String(id) }) });

describe.skipIf(!hasMainlinePostgres)("kith-inn real CMS/PostgreSQL mainline", () => {
  let payload: Payload;
  let sellerA: MainlineTenant;
  let sellerB: MainlineTenant;
  let originalJwtSecret: string | undefined;
  let v1SellerId: Id | undefined;
  let v1ProfileId: Id | undefined;

  const createCustomer = async (tenant: MainlineTenant, name: string): Promise<JsonDoc> =>
    json(await customers.POST(routeRequest(tenant.token, "/customers", "POST", { displayName: name, address: `${name}-address` })), 201);

  const draftInput = (customer: Id, offering: Id, date: string) => ({
    customer,
    date,
    occasion: "lunch",
    source: "manual",
    totalCents: 3000,
    items: [{ offering, quantity: 1, unitPriceCents: 3000 }],
  });

  const createDraft = async (tenant: MainlineTenant, customer: Id, date: string): Promise<JsonDoc> => {
    const result = await json<{ order: JsonDoc }>(await orders.POST(
      routeRequest(tenant.token, "/orders", "POST", draftInput(customer, tenant.comboId, date)),
    ), 201);
    return result.order;
  };

  const confirm = async (tenant: MainlineTenant, orderId: Id) =>
    json<{ fulfillments: JsonDoc[] }>(await orderConfirm.POST(
      routeRequest(tenant.token, `/orders/${orderId}/confirm`, "POST"),
      params(orderId),
    ));

  const tenantState = async (sellerId: Id) => {
    const collections = ["customers", "orders", "fulfillments", "service_slots", "menu_plans", "offerings"] as const;
    return Object.fromEntries(await Promise.all(collections.map(async (collection) => {
      const found = await payload.find({ collection, where: { seller: { equals: sellerId } }, limit: 0, overrideAccess: true });
      return [collection, found.docs.map(({ id, status, updatedAt }) => ({ id, status, updatedAt }))];
    })));
  };

  beforeAll(async () => {
    originalJwtSecret = process.env.JWT_SECRET;
    ({ payload, sellerA, sellerB } = await startKithInnMainline());
  }, 60_000);

  afterAll(async () => {
    try {
      if (payload) {
        await resetSeedData(payload as Parameters<typeof resetSeedData>[0]);
        if (v1ProfileId !== undefined) await payload.delete({ collection: "kiv1_customer_profiles", id: v1ProfileId, overrideAccess: true });
        if (v1SellerId !== undefined) await payload.delete({ collection: "kiv1_sellers", id: v1SellerId, overrideAccess: true });
      }
    } finally {
      try {
        if (payload) await payload.destroy();
      } finally {
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
      }
    }
  });

  it("runs customer/order/reconcile/confirm/slot/menu/fulfillment happy paths through real routes", async () => {
    const customer = await createCustomer(sellerA, "A顾客");
    const order = await createDraft(sellerA, customer.id, "2026-10-01");
    const confirmed = await confirm(sellerA, order.id);
    expect(confirmed.fulfillments).toEqual([expect.objectContaining({ status: "pending" })]);

    const reconciled = await json<{ created: JsonDoc[] }>(await orderReconcile.POST(routeRequest(sellerA.token, "/orders/reconcile", "POST", {
      mode: "snapshot",
      operationKey: crypto.randomUUID(),
      scope: [{ date: "2026-10-02", occasion: "lunch" }],
      expectedFingerprint: fingerprintActiveOrders([]),
      candidates: [{ customer: customer.id, date: "2026-10-02", occasion: "lunch", quantity: 1, offering: sellerA.comboId, unitPriceCents: 3000, totalCents: 3000 }],
    })));
    expect(reconciled.created).toHaveLength(1);

    await json(await serviceSlots.POST(routeRequest(sellerA.token, "/service-slots/upsert", "POST", [
      { date: "2026-10-03", occasion: "lunch", granularity: "occasion" },
    ])));
    const upserted = await json<{ docs: JsonDoc[] }>(await menuPlanUpsert.POST(routeRequest(sellerA.token, "/menu-plans/upsert", "POST", [
      { date: "2026-10-03", occasion: "lunch", offerings: [sellerA.componentId], status: "draft" },
    ])));
    expect(upserted.docs).toHaveLength(1);

    const listedOrders = await json<{ docs: JsonDoc[] }>(await orders.GET(routeRequest(sellerA.token, "/orders")));
    const listedFulfillments = await json<{ docs: JsonDoc[] }>(await fulfillments.GET(routeRequest(sellerA.token, "/fulfillments")));
    const listedPlans = await json<{ docs: JsonDoc[] }>(await menuPlans.GET(routeRequest(sellerA.token, "/menu-plans?from=2026-10-01&to=2026-10-03")));
    expect(listedOrders.docs.map(({ id }) => id)).toEqual(expect.arrayContaining([order.id]));
    expect(listedFulfillments.docs).toHaveLength(1);
    expect(listedPlans.docs.map(({ id }) => id)).toContain(upserted.docs[0]!.id);
  });

  it("fails closed for cross-seller reads, updates, bulk ids and relationships", async () => {
    const [customerA, customerB] = await Promise.all([
      createCustomer(sellerA, "攻击矩阵A"),
      createCustomer(sellerB, "攻击矩阵B"),
    ]);
    const orderA = await createDraft(sellerA, customerA.id, "2026-10-10");
    const orderB = await createDraft(sellerB, customerB.id, "2026-10-10");
    const fulfillmentA = (await confirm(sellerA, orderA.id)).fulfillments[0]!;
    const fulfillmentB = (await confirm(sellerB, orderB.id)).fulfillments[0]!;
    const planBResponse = await menuPlanUpsert.POST(routeRequest(sellerB.token, "/menu-plans/upsert", "POST", [
      { date: "2026-10-10", occasion: "lunch", offerings: [sellerB.componentId], status: "draft" },
    ]));
    const planB = (await json<{ docs: JsonDoc[] }>(planBResponse)).docs[0]!;
    const beforeB = await tenantState(sellerB.sellerId);

    const customerListA = await json<{ docs: JsonDoc[] }>(await customers.GET(routeRequest(sellerA.token, "/customers")));
    const orderListA = await json<{ docs: JsonDoc[] }>(await orders.GET(routeRequest(sellerA.token, "/orders")));
    const fulfillmentListA = await json<{ docs: JsonDoc[] }>(await fulfillments.GET(routeRequest(sellerA.token, "/fulfillments")));
    expect(customerListA.docs.map(({ id }) => id)).not.toContain(customerB.id);
    expect(orderListA.docs.map(({ id }) => id)).not.toContain(orderB.id);
    expect(fulfillmentListA.docs.map(({ id }) => id)).not.toContain(fulfillmentB.id);
    expect((await orderDetail.GET(routeRequest(sellerA.token, `/orders/${orderB.id}`), params(orderB.id))).status).toBe(404);
    expect((await menuPlanDetail.GET(routeRequest(sellerA.token, `/menu-plans/${planB.id}`), params(planB.id))).status).toBe(404);
    expect((await orderDetail.PATCH(routeRequest(sellerA.token, `/orders/${orderB.id}`, "PATCH", { paymentStatus: "paid" }), params(orderB.id))).status).toBe(404);

    const bulkResponse = await fulfillments.PATCH(routeRequest(sellerA.token, "/fulfillments", "PATCH", {
      ids: [fulfillmentA.id, fulfillmentB.id],
      set: { status: "done" },
    }));
    await expect(json<{ updated: number }>(bulkResponse)).resolves.toMatchObject({ updated: 1 });
    expect((await menuPlanUpsert.POST(routeRequest(sellerA.token, "/menu-plans/upsert", "POST", [
      { date: "2026-10-11", occasion: "lunch", offerings: [sellerB.componentId], status: "draft" },
    ]))).status).toBe(403);
    expect((await orders.POST(routeRequest(
      sellerA.token,
      "/orders",
      "POST",
      draftInput(customerB.id, sellerA.comboId, "2026-10-11"),
    ))).status).toBe(403);
    expect((await orders.POST(routeRequest(
      sellerA.token,
      "/orders",
      "POST",
      draftInput(customerA.id, sellerB.comboId, "2026-10-12"),
    ))).status).toBe(403);
    expect(await tenantState(sellerB.sellerId)).toEqual(beforeB);
  });

  it("runs the real kith-inn reset/seed without accessing or changing a v1 sentinel", async () => {
    const v1Seller = await payload.create({ collection: "kiv1_sellers", data: { name: `v1-sentinel-${crypto.randomUUID()}`, defaultPriceCents: 3000, status: "active" }, overrideAccess: true });
    v1SellerId = v1Seller.id;
    const v1Profile = await payload.create({ collection: "kiv1_customer_profiles", data: { seller: v1Seller.id, openid: crypto.randomUUID(), displayName: "不可改哨兵", address: "sentinel-address", active: true }, overrideAccess: true });
    v1ProfileId = v1Profile.id;
    const before = await payload.findByID({ collection: "kiv1_customer_profiles", id: v1Profile.id, overrideAccess: true });
    const beforeCount = (await payload.find({ collection: "kiv1_customer_profiles", where: { seller: { equals: v1Seller.id } }, limit: 0, overrideAccess: true })).totalDocs;
    const findSpy = vi.spyOn(payload, "find");
    const createSpy = vi.spyOn(payload, "create");
    const deleteSpy = vi.spyOn(payload, "delete");

    await runProjectSeed(payload, "kith-inn", true);

    const calls: unknown[][] = [
      ...(findSpy.mock.calls as unknown as unknown[][]),
      ...(createSpy.mock.calls as unknown as unknown[][]),
      ...(deleteSpy.mock.calls as unknown as unknown[][]),
    ];
    const v1Calls = calls.filter(([args]) => String((args as { collection?: string }).collection).startsWith("kiv1_"));
    findSpy.mockRestore();
    createSpy.mockRestore();
    deleteSpy.mockRestore();
    expect(v1Calls).toEqual([]);
    await expect(payload.findByID({ collection: "kiv1_customer_profiles", id: v1Profile.id, overrideAccess: true })).resolves.toEqual(before);
    await expect(payload.find({ collection: "kiv1_customer_profiles", where: { seller: { equals: v1Seller.id } }, limit: 0, overrideAccess: true })).resolves.toMatchObject({ totalDocs: beforeCount });
  });
});
