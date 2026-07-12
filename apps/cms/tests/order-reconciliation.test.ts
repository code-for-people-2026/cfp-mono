import type { OrderReconciliationRequest } from "@cfp/kith-inn-shared";
import { fingerprintActiveOrders } from "@cfp/kith-inn-shared/orderReconciliation";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "../payload.config";
import { confirmOrderAtomic, createDraftAtomic, reconcileOrdersAtomic } from "../src/lib/orderLifecycle";
import { lockOrderReconciliationWrites, withTransaction } from "../src/lib/internal";

describe.skipIf(!process.env.DATABASE_URL && !process.env.PAYLOAD_DATABASE_URL)("order reconciliation", () => {
  let payload: Payload;
  let sellerId: string | number;
  let operatorId: string | number;
  let offeringId: string | number;
  const customers: Array<{ id: string | number; displayName: string }> = [];
  const suffix = crypto.randomUUID();
  const date = "2026-09-13";
  const scope = [{ date, occasion: "lunch" as const }];

  const activeFingerprint = async (targetDate = date, targetCustomer?: string | number) => {
    const orders = await payload.find({
      collection: "orders",
      where: { and: [{ seller: { equals: sellerId } }, { date: { equals: targetDate } }, { occasion: { equals: "lunch" } }, { status: { in: ["draft", "confirmed"] } }] },
      depth: 1,
      limit: 0,
      overrideAccess: true,
    });
    const targetOrders = targetCustomer === undefined
      ? orders.docs
      : orders.docs.filter((order) => String(typeof order.customer === "object" ? order.customer.id : order.customer) === String(targetCustomer));
    const items = await payload.find({ collection: "order_items", where: { order: { in: targetOrders.map((order) => order.id) } }, limit: 0, overrideAccess: true });
    return fingerprintActiveOrders(targetOrders.map((order) => ({
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

  const incrementRequest = async (targetDate: string, customer: string | number, quantity: number, operation: "add" | "set", operationKey = crypto.randomUUID()): Promise<OrderReconciliationRequest> => ({
    mode: "increment",
    operation,
    operationKey,
    scope: [{ date: targetDate, occasion: "lunch" }],
    expectedFingerprint: await activeFingerprint(targetDate, customer),
    candidates: [{ customer, date: targetDate, occasion: "lunch", quantity, offering: offeringId, unitPriceCents: 3000, totalCents: quantity * 3000 }],
  });

  const orderQuantity = async (orderId: string | number) => {
    const items = await payload.find({ collection: "order_items", where: { order: { equals: orderId } }, limit: 1, overrideAccess: true });
    return items.docs[0]!.quantity;
  };

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
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).resolves.toMatchObject({
      alreadyApplied: true,
      unchanged: [{ orderId: created[1]!.order.id }],
    });
    const fulfillment = await payload.find({ collection: "fulfillments", where: { order: { equals: created[2]!.order.id } }, limit: 1, overrideAccess: true });
    expect(fulfillment.docs[0]?.status).toBe("canceled");
  });

  it("rejects stale previews without writes", async () => {
    const body = await request([candidate(customers[0]!.id, 3)]);
    const existing = await payload.find({ collection: "orders", where: { and: [{ seller: { equals: sellerId } }, { customer: { equals: customers[0]!.id } }, { status: { in: ["draft", "confirmed"] } }] }, limit: 1, overrideAccess: true });
    await payload.update({ collection: "orders", id: existing.docs[0]!.id, data: { paymentStatus: "paid" }, overrideAccess: true });
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).rejects.toMatchObject({ code: "stale-preview" });
    await payload.update({ collection: "orders", id: existing.docs[0]!.id, data: { paymentStatus: "unpaid" }, overrideAccess: true });
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

  it("preserves an unchanged paid order after its combo price changes", async () => {
    const priceDate = "2026-09-22";
    const pricedOffering = await payload.create({ collection: "offerings", data: { name: `历史价套餐 ${suffix}`, kind: "combo-meal", priceCents: 2500, active: true, seller: sellerId }, overrideAccess: true });
    const draft = await createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[2]!.id, date: priceDate, occasion: "lunch", source: "manual", totalCents: 2500,
      items: [{ offering: pricedOffering.id, quantity: 1, unitPriceCents: 2500 }],
    });
    await confirmOrderAtomic(payload, sellerId, draft.order.id);
    await payload.update({ collection: "orders", id: draft.order.id, data: { paymentStatus: "paid" }, overrideAccess: true });
    const current = await payload.findByID({ collection: "orders", id: draft.order.id, depth: 1, overrideAccess: true });
    const items = await payload.find({ collection: "order_items", where: { order: { equals: draft.order.id } }, limit: 0, overrideAccess: true });
    await payload.update({ collection: "offerings", id: pricedOffering.id, data: { priceCents: 3200 }, overrideAccess: true });
    const body: OrderReconciliationRequest = {
      mode: "snapshot", operationKey: crypto.randomUUID(), scope: [{ date: priceDate, occasion: "lunch" }],
      expectedFingerprint: fingerprintActiveOrders([{ ...current, occasion: "lunch", paymentStatus: "paid", items: items.docs } as never]),
      candidates: [{ customer: customers[2]!.id, date: priceDate, occasion: "lunch", quantity: 1, offering: pricedOffering.id, unitPriceCents: 2500, totalCents: 2500 }],
    };

    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).resolves.toMatchObject({ unchanged: [{ orderId: draft.order.id }] });
    const unchanged = await payload.findByID({ collection: "orders", id: draft.order.id, overrideAccess: true });
    expect(unchanged.totalCents).toBe(2500);
  });

  it.each(["paid", "done"])("rejects changing a confirmed order whose side effect is %s", async (settledState) => {
    const settledDate = settledState === "paid" ? "2026-09-16" : "2026-09-17";
    const draft = await createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[0]!.id, date: settledDate, occasion: "lunch", source: "manual", totalCents: 3000,
      items: [{ offering: offeringId, quantity: 1, unitPriceCents: 3000 }],
    });
    const confirmed = await confirmOrderAtomic(payload, sellerId, draft.order.id);
    if (settledState === "paid") await payload.update({ collection: "orders", id: draft.order.id, data: { paymentStatus: "paid" }, overrideAccess: true });
    else await payload.update({ collection: "fulfillments", id: confirmed.fulfillments[0]!.id, data: { status: "done" }, overrideAccess: true });
    const current = await payload.findByID({ collection: "orders", id: draft.order.id, depth: 1, overrideAccess: true });
    const items = await payload.find({ collection: "order_items", where: { order: { equals: draft.order.id } }, limit: 0, overrideAccess: true });
    const body: OrderReconciliationRequest = {
      mode: "snapshot", operationKey: crypto.randomUUID(), scope: [{ date: settledDate, occasion: "lunch" }],
      expectedFingerprint: fingerprintActiveOrders([{ ...current, occasion: "lunch", paymentStatus: current.paymentStatus as string, items: items.docs } as never]),
      candidates: [{ customer: customers[0]!.id, date: settledDate, occasion: "lunch", quantity: 2, offering: offeringId, unitPriceCents: 3000, totalCents: 6000 }],
    };

    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).rejects.toMatchObject({ code: "settled-order" });
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, {
      ...body,
      mode: "increment",
      operation: "set",
      operationKey: crypto.randomUUID(),
      candidates: [{ ...body.candidates[0]!, quantity: 1, totalCents: 3000 }],
    })).rejects.toMatchObject({ code: "settled-order" });
  });

  it("blocks regular order writes while a reconciliation write lock is held", async () => {
    const lockDate = "2026-09-18";
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const lockTransaction = withTransaction(payload, async (req) => {
      await lockOrderReconciliationWrites(payload, req);
      locked();
      await hold;
    });
    await acquired;
    let created = false;
    const regularWrite = createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[1]!.id, date: lockDate, occasion: "lunch", source: "manual", totalCents: 3000,
      items: [{ offering: offeringId, quantity: 1, unitPriceCents: 3000 }],
    }).then(() => { created = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(created).toBe(false);
    } finally {
      release();
      await Promise.all([lockTransaction, regularWrite]);
    }
    expect(created).toBe(true);
  });

  it("makes reconciliation read after a regular confirmation that already holds the lock", async () => {
    const lockDate = "2026-09-19";
    const draft = await createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[1]!.id, date: lockDate, occasion: "lunch", source: "manual", totalCents: 3000,
      items: [{ offering: offeringId, quantity: 1, unitPriceCents: 3000 }],
    });
    const current = await payload.findByID({ collection: "orders", id: draft.order.id, depth: 1, overrideAccess: true });
    const items = await payload.find({ collection: "order_items", where: { order: { equals: draft.order.id } }, limit: 0, overrideAccess: true });
    const body: OrderReconciliationRequest = {
      mode: "snapshot",
      operationKey: crypto.randomUUID(),
      scope: [{ date: lockDate, occasion: "lunch" }],
      expectedFingerprint: fingerprintActiveOrders([{ ...current, occasion: "lunch", paymentStatus: current.paymentStatus as string, items: items.docs } as never]),
      candidates: [{ customer: customers[1]!.id, date: lockDate, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 }],
    };
    let release!: () => void;
    let paused!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const reachedRead = new Promise<void>((resolve) => { paused = resolve; });
    const find = payload.find.bind(payload);
    let intercepted = false;
    const spy = vi.spyOn(payload, "find").mockImplementation(async (args) => {
      if (!intercepted && args.collection === "orders" && args.req) {
        intercepted = true;
        paused();
        await hold;
      }
      return find(args as never);
    });
    const confirming = confirmOrderAtomic(payload, sellerId, draft.order.id);
    await reachedRead;
    let reconciled = false;
    const reconciliation = reconcileOrdersAtomic(payload, sellerId, operatorId, body)
      .then((value) => ({ value }), (error: unknown) => ({ error }))
      .finally(() => { reconciled = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(reconciled).toBe(false);
    } finally {
      release();
      await confirming;
      spy.mockRestore();
    }
    expect(await reconciliation).toMatchObject({ error: { code: "stale-preview" } });
  });

  it("reuses the address supplied by a later row for one normalized new customer", async () => {
    const customerName = `后补地址${suffix}`;
    const addressDate = "2026-09-20";
    const body: OrderReconciliationRequest = {
      mode: "snapshot",
      operationKey: crypto.randomUUID(),
      scope: [{ date: addressDate, occasion: "lunch" }, { date: addressDate, occasion: "dinner" }],
      expectedFingerprint: fingerprintActiveOrders([]),
      candidates: [
        { newCustomer: { displayName: customerName }, date: addressDate, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 },
        { newCustomer: { displayName: customerName, address: "26B" }, date: addressDate, occasion: "dinner", quantity: 2, offering: offeringId, unitPriceCents: 3000, totalCents: 6000 },
      ],
    };

    await reconcileOrdersAtomic(payload, sellerId, operatorId, body);
    const createdCustomers = await payload.find({ collection: "customers", where: { and: [{ seller: { equals: sellerId } }, { displayName: { equals: customerName } }] }, limit: 0, overrideAccess: true });
    const createdOrders = await payload.find({ collection: "orders", where: { and: [{ seller: { equals: sellerId } }, { date: { equals: addressDate } }] }, limit: 0, overrideAccess: true });
    expect(createdCustomers.docs).toHaveLength(1);
    expect(createdCustomers.docs[0]?.address).toBe("26B");
    expect(createdOrders.docs).toHaveLength(2);
    expect(createdOrders.docs.map((order) => order.address)).toEqual(["26B", "26B"]);
  });

  it("rejects a new-customer preview when that normalized name now exists", async () => {
    const customerName = `预览后 新客${suffix}`;
    const staleDate = "2026-09-21";
    const body: OrderReconciliationRequest = {
      mode: "snapshot",
      operationKey: crypto.randomUUID(),
      scope: [{ date: staleDate, occasion: "lunch" }],
      expectedFingerprint: fingerprintActiveOrders([]),
      candidates: [{ newCustomer: { displayName: customerName }, date: staleDate, occasion: "lunch", quantity: 1, offering: offeringId, unitPriceCents: 3000, totalCents: 3000 }],
    };
    await payload.create({ collection: "customers", data: { displayName: `  预览后   新客${suffix}  `, seller: sellerId }, overrideAccess: true });

    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, body)).rejects.toMatchObject({ code: "stale-preview" });
    const createdOrders = await payload.find({ collection: "orders", where: { and: [{ seller: { equals: sellerId } }, { date: { equals: staleDate } }] }, limit: 0, overrideAccess: true });
    expect(createdOrders.docs).toHaveLength(0);
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

  it("creates a draft when add targets a missing coordinate", async () => {
    const incrementDate = "2026-09-23";
    const result = await reconcileOrdersAtomic(payload, sellerId, operatorId, await incrementRequest(incrementDate, customers[0]!.id, 2, "add"));
    const created = await payload.findByID({ collection: "orders", id: result.created[0]!.orderId, overrideAccess: true });

    expect(created).toMatchObject({ status: "draft", source: "manual", totalCents: 6000 });
    expect(await orderQuantity(created.id)).toBe(2);
  });

  it("applies add/set to one confirmed coordinate and retries add only once", async () => {
    const incrementDate = "2026-09-24";
    const target = await createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[0]!.id, date: incrementDate, occasion: "lunch", source: "manual", totalCents: 3000,
      items: [{ offering: offeringId, quantity: 1, unitPriceCents: 3000 }],
    });
    const other = await createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[1]!.id, date: incrementDate, occasion: "lunch", source: "manual", totalCents: 12000,
      items: [{ offering: offeringId, quantity: 4, unitPriceCents: 3000 }],
    });
    await confirmOrderAtomic(payload, sellerId, target.order.id);
    const add = await incrementRequest(incrementDate, customers[0]!.id, 2, "add");
    await reconcileOrdersAtomic(payload, sellerId, operatorId, await incrementRequest(incrementDate, customers[1]!.id, 1, "add"));

    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, add)).resolves.toMatchObject({ updated: [{ beforeQuantity: 1, afterQuantity: 3 }] });
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, add)).resolves.toMatchObject({ alreadyApplied: true });
    await expect(reconcileOrdersAtomic(payload, sellerId, operatorId, await incrementRequest(incrementDate, customers[0]!.id, 2, "set"))).resolves.toMatchObject({ updated: [{ beforeQuantity: 3, afterQuantity: 2 }] });
    expect(await orderQuantity(target.order.id)).toBe(2);
    expect(await orderQuantity(other.order.id)).toBe(5);
    await expect(payload.findByID({ collection: "orders", id: target.order.id, overrideAccess: true })).resolves.toMatchObject({ status: "confirmed" });
    const fulfillments = await payload.find({ collection: "fulfillments", where: { order: { equals: target.order.id } }, limit: 1, overrideAccess: true });
    expect(fulfillments.docs[0]).toMatchObject({ status: "pending" });
  });

  it("lets only one of two independent adds based on the same preview apply", async () => {
    const incrementDate = "2026-09-25";
    const target = await createDraftAtomic(payload, sellerId, operatorId, {
      customer: customers[2]!.id, date: incrementDate, occasion: "lunch", source: "manual", totalCents: 3000,
      items: [{ offering: offeringId, quantity: 1, unitPriceCents: 3000 }],
    });
    const first = await incrementRequest(incrementDate, customers[2]!.id, 2, "add");
    const results = await Promise.allSettled([
      reconcileOrdersAtomic(payload, sellerId, operatorId, first),
      reconcileOrdersAtomic(payload, sellerId, operatorId, { ...first, operationKey: crypto.randomUUID() }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected").map((result) => result.reason)).toEqual([expect.objectContaining({ code: "stale-preview" })]);
    expect(await orderQuantity(target.order.id)).toBe(3);
  });
});
