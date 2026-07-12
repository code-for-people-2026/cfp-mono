import type { OrderReconciliationRequest } from "@cfp/kith-inn-shared";
import { fingerprintActiveOrders } from "@cfp/kith-inn-shared/orderReconciliation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "../payload.config";
import { confirmOrderAtomic, createDraftAtomic, reconcileOrdersAtomic } from "../src/lib/orderLifecycle";

describe.skipIf(!process.env.DATABASE_URL && !process.env.PAYLOAD_DATABASE_URL)("order snapshot reconciliation", () => {
  let payload: Payload;
  let sellerId: string | number;
  let operatorId: string | number;
  let offeringId: string | number;
  const customers: Array<{ id: string | number; displayName: string }> = [];
  const suffix = crypto.randomUUID();
  const date = "2026-09-13";
  const scope = [{ date, occasion: "lunch" as const }];

  const activeFingerprint = async () => {
    const orders = await payload.find({
      collection: "orders",
      where: { and: [{ seller: { equals: sellerId } }, { date: { equals: date } }, { occasion: { equals: "lunch" } }, { status: { in: ["draft", "confirmed"] } }] },
      depth: 1,
      limit: 0,
      overrideAccess: true,
    });
    const items = await payload.find({ collection: "order_items", where: { order: { in: orders.docs.map((order) => order.id) } }, limit: 0, overrideAccess: true });
    return fingerprintActiveOrders(orders.docs.map((order) => ({
      id: order.id,
      customer: order.customer as { id: string | number },
      date: order.date,
      status: order.status as "draft" | "confirmed",
      paymentStatus: order.paymentStatus as string,
      occasion: order.occasion as string,
      updatedAt: order.updatedAt,
      items: items.docs.filter((entry) => String(typeof entry.order === "object" ? entry.order.id : entry.order) === String(order.id)).map((entry) => ({
        id: entry.id,
        offering: entry.offering as string | number,
        quantity: entry.quantity,
        unitPriceCents: entry.unitPriceCents ?? undefined,
      })),
    })));
  };

  const request = async (candidates: OrderReconciliationRequest["candidates"], operationKey = crypto.randomUUID()): Promise<OrderReconciliationRequest> => ({
    mode: "snapshot",
    operationKey,
    scope,
    expectedFingerprint: await activeFingerprint(),
    candidates,
  });

  const candidate = (customer: string | number, quantity: number) => ({
    customer, date, occasion: "lunch" as const, quantity, offering: offeringId, unitPriceCents: 3000, totalCents: quantity * 3000,
  });

  beforeAll(async () => {
    payload = await getPayload({ config });
    const seller = await payload.create({ collection: "sellers", data: { name: `对账测试 ${suffix}`, status: "active", defaultPriceCents: 3000 }, overrideAccess: true });
    sellerId = seller.id;
    operatorId = (await payload.create({ collection: "operators", data: { email: `reconcile-${suffix}@test.local`, password: `${suffix}-password`, wechatOpenid: suffix, role: "owner", active: true, seller: sellerId }, overrideAccess: true })).id;
    offeringId = (await payload.create({ collection: "offerings", data: { name: `套餐 ${suffix}`, kind: "combo-meal", priceCents: 3000, active: true, seller: sellerId }, overrideAccess: true })).id;
    for (const displayName of ["王阿姨", "李叔叔", "陈老师"]) {
      const customer = await payload.create({ collection: "customers", data: { displayName: `${displayName}${suffix}`, address: "26B", seller: sellerId }, overrideAccess: true });
      customers.push({ id: customer.id, displayName: customer.displayName });
    }
  }, 60_000);

  afterAll(async () => {
    if (!payload) return;
    for (const collection of ["fulfillments", "order_items", "orders", "service_slots", "customers", "offerings", "operators"] as const) {
      await payload.delete({ collection, where: { seller: { equals: sellerId } }, overrideAccess: true });
    }
    await payload.delete({ collection: "sellers", id: sellerId, overrideAccess: true });
    await payload.destroy();
  });

  it("atomically creates, updates, cancels and preserves unchanged/confirmed fulfillment state", async () => {
    const created = [];
    for (const [index, customer] of customers.entries()) {
      created.push(await createDraftAtomic(payload, sellerId, operatorId, { customer: customer.id, date, occasion: "lunch", source: "manual", totalCents: (index + 1) * 3000, items: [{ offering: offeringId, quantity: index + 1, unitPriceCents: 3000 }] }));
    }
    await confirmOrderAtomic(payload, sellerId, created[2]!.order.id);
    const body = await request([
      candidate(customers[0]!.id, 2),
      candidate(customers[1]!.id, 2),
      { newCustomer: { displayName: `新街坊${suffix}`, address: "28C" }, date, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 },
    ]);
    const result = await reconcileOrdersAtomic(payload, sellerId, operatorId, body);
    expect(result).toMatchObject({ created: [{}], updated: [{ orderId: created[0]!.order.id, beforeQuantity: 1, afterQuantity: 2 }], canceled: [{ orderId: created[2]!.order.id }], unchanged: [{ orderId: created[1]!.order.id }] });
    const fulfillment = await payload.find({ collection: "fulfillments", where: { order: { equals: created[2]!.order.id } }, limit: 1, overrideAccess: true });
    expect(fulfillment.docs[0]?.status).toBe("canceled");
  });

  it("rejects stale previews without writes", async () => {
    const body = await request([candidate(customers[0]!.id, 3)]);
    const existing = await payload.find({ collection: "orders", where: { and: [{ seller: { equals: sellerId } }, { customer: { equals: customers[0]!.id } }, { status: { in: ["draft", "confirmed"] } }] }, limit: 1, overrideAccess: true });
    await payload.update({ collection: "orders", id: existing.docs[0]!.id, data: { paymentStatus: "paid" }, overrideAccess: true });
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).rejects.toMatchObject({ code: "stale-preview" });
  });

  it("rejects a preview after its combo price changes", async () => {
    const driftDate = "2026-09-14";
    const driftOffering = await payload.create({ collection: "offerings", data: { name: `改价套餐 ${suffix}`, kind: "combo-meal", priceCents: 3000, active: true, seller: sellerId }, overrideAccess: true });
    const body: OrderReconciliationRequest = {
      mode: "snapshot",
      operationKey: crypto.randomUUID(),
      scope: [{ date: driftDate, occasion: "lunch" }],
      expectedFingerprint: fingerprintActiveOrders([]),
      candidates: [{ customer: customers[0]!.id, date: driftDate, occasion: "lunch", quantity: 1, offering: driftOffering.id, unitPriceCents: 3000, totalCents: 3000 }],
    };
    await payload.update({ collection: "offerings", id: driftOffering.id, data: { priceCents: 3200 }, overrideAccess: true });

    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).rejects.toMatchObject({ code: "stale-preview" });
  });

  it("rolls back every change on an injected item failure", async () => {
    const before = await activeFingerprint();
    const body = await request([{ newCustomer: { displayName: `失败新客${suffix}` }, date, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 }]);
    const create = payload.create.bind(payload);
    const spy = vi.spyOn(payload, "create").mockImplementation(async (args) => args.collection === "order_items" ? Promise.reject(new Error("injected reconcile failure")) : create(args as never));
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).rejects.toThrow("injected reconcile failure");
    spy.mockRestore();
    expect(await activeFingerprint()).toBe(before);
  });

  it("applies repeat and concurrent submissions with the same operation key once", async () => {
    const operationKey = crypto.randomUUID();
    const body = await request([{ newCustomer: { displayName: `并发新客${suffix}` }, date, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 }], operationKey);
    const results = await Promise.all([
      reconcileOrdersAtomic(payload, sellerId, operatorId, body),
      reconcileOrdersAtomic(payload, sellerId, operatorId, body),
    ]);
    expect(results.some((result) => result.alreadyApplied)).toBe(true);
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).resolves.toMatchObject({ ok: true, alreadyApplied: true });
  });

  it("serializes different snapshot operations for the same empty scope", async () => {
    const concurrentDate = "2026-09-15";
    const concurrentScope = [{ date: concurrentDate, occasion: "lunch" as const }];
    const makeBody = (displayName: string): OrderReconciliationRequest => ({
      mode: "snapshot",
      operationKey: crypto.randomUUID(),
      scope: concurrentScope,
      expectedFingerprint: fingerprintActiveOrders([]),
      candidates: [{ newCustomer: { displayName }, date: concurrentDate, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 }],
    });

    const results = await Promise.allSettled([
      reconcileOrdersAtomic(payload, sellerId, operatorId, makeBody(`并发甲${suffix}`)),
      reconcileOrdersAtomic(payload, sellerId, operatorId, makeBody(`并发乙${suffix}`)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected").map((result) => result.reason)).toEqual([expect.objectContaining({ code: "stale-preview" })]);
    const active = await payload.find({
      collection: "orders",
      where: { and: [{ seller: { equals: sellerId } }, { date: { equals: concurrentDate } }, { occasion: { equals: "lunch" } }, { status: { in: ["draft", "confirmed"] } }] },
      limit: 0,
      overrideAccess: true,
    });
    expect(active.docs).toHaveLength(1);
  });
});
