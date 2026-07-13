import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "../payload.config";
import { withTransaction } from "../src/lib/internal";
import { cancelOrderAtomic, confirmOrderAtomic, createDraftAtomic, type DraftBody } from "../src/lib/orderLifecycle";

describe.skipIf(Boolean(process.env.DATABASE_URL || process.env.PAYLOAD_DATABASE_URL))("SQLite fallback transactions", () => {
  let payload: Payload;

  beforeAll(async () => {
    payload = await getPayload({ config });
  });

  afterAll(async () => {
    if (payload) await payload.destroy();
  });

  it("starts the shared request transaction used by atomic order writes", async () => {
    await expect(withTransaction(payload, async () => "ok")).resolves.toBe("ok");
  });
});

describe.skipIf(!process.env.DATABASE_URL && !process.env.PAYLOAD_DATABASE_URL)("kith-inn order atomicity", () => {
  let payload: Payload;
  let sellerId: string | number;
  let operatorId: string | number;
  let customerId: string | number;
  let offeringId: string | number;
  const suffix = crypto.randomUUID();

  const draft = (date: string): DraftBody => ({
    customer: customerId,
    date,
    occasion: "lunch",
    source: "manual",
    totalCents: 6000,
    items: [
      { offering: offeringId, quantity: 1, unitPriceCents: 3000 },
      { offering: offeringId, quantity: 1, unitPriceCents: 3000 },
    ],
  });

  const orderState = async (id: string | number) => {
    const order = await payload.findByID({ collection: "orders", id, overrideAccess: true });
    const fulfillments = await payload.find({ collection: "fulfillments", where: { order: { equals: id } }, limit: 0, overrideAccess: true });
    return { order, fulfillments: fulfillments.docs };
  };

  beforeAll(async () => {
    payload = await getPayload({ config });
    const seller = await payload.create({ collection: "sellers", data: { name: `原子性测试 ${suffix}`, status: "active" }, overrideAccess: true });
    sellerId = seller.id;
    const operator = await payload.create({
      collection: "operators",
      data: {
        email: `atomic-${suffix}@test.local`,
        password: `atomic-${suffix}-password`,
        wechatOpenid: `atomic-${suffix}`,
        role: "owner",
        active: true,
        seller: sellerId,
      },
      overrideAccess: true,
    });
    operatorId = operator.id;
    customerId = (await payload.create({ collection: "customers", data: { displayName: `顾客 ${suffix}`, address: "1D-28D", seller: sellerId }, overrideAccess: true })).id;
    offeringId = (await payload.create({ collection: "offerings", data: { name: `套餐 ${suffix}`, kind: "combo-meal", priceCents: 3000, active: true, seller: sellerId }, overrideAccess: true })).id;
  }, 60_000);

  afterAll(async () => {
    if (!payload) return;
    for (const collection of ["fulfillments", "order_items", "orders", "service_slots", "customers", "offerings", "operators"] as const) {
      await payload.delete({ collection, where: { seller: { equals: sellerId } }, overrideAccess: true });
    }
    await payload.delete({ collection: "sellers", id: sellerId, overrideAccess: true });
    await payload.destroy();
  });

  it("rolls back the order when an item write fails and permits a clean retry", async () => {
    const input = draft("2026-08-01");
    const create = payload.create.bind(payload);
    let itemWrites = 0;
    const spy = vi.spyOn(payload, "create").mockImplementation(async (args) => {
      if (args.collection === "order_items" && ++itemWrites === 2) throw new Error("injected item failure");
      return create(args as never);
    });
    await expect(createDraftAtomic(payload, sellerId, operatorId, input)).rejects.toThrow("injected item failure");
    spy.mockRestore();

    const afterFailure = await payload.find({
      collection: "orders",
      where: { and: [{ seller: { equals: sellerId } }, { date: { equals: input.date } }] },
      limit: 0,
      overrideAccess: true,
    });
    expect(afterFailure.docs).toHaveLength(0);
    await expect(createDraftAtomic(payload, sellerId, operatorId, input)).resolves.toMatchObject({ items: [{}, {}] });
  });

  it("rolls back slot and fulfillment when the confirmed status write fails", async () => {
    const created = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-02"));
    const update = payload.update.bind(payload);
    const spy = vi.spyOn(payload, "update").mockImplementation((async (args: Parameters<Payload["update"]>[0]) => {
      if (args.collection === "orders" && "data" in args && args.data.status === "confirmed") throw new Error("injected status failure");
      return update(args as never);
    }) as never);
    await expect(confirmOrderAtomic(payload, sellerId, created.order.id)).rejects.toThrow("injected status failure");
    spy.mockRestore();

    const state = await orderState(created.order.id);
    expect(state.order.status).toBe("draft");
    expect(state.fulfillments).toHaveLength(0);
    const slots = await payload.find({ collection: "service_slots", where: { and: [{ seller: { equals: sellerId } }, { date: { equals: "2026-08-02" } }] }, limit: 0, overrideAccess: true });
    expect(slots.docs).toHaveLength(0);
  });

  it("rolls back slot when the fulfillment write fails", async () => {
    const created = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-03"));
    const create = payload.create.bind(payload);
    const spy = vi.spyOn(payload, "create").mockImplementation(async (args) => {
      if (args.collection === "fulfillments") throw new Error("injected fulfillment failure");
      return create(args as never);
    });
    await expect(confirmOrderAtomic(payload, sellerId, created.order.id)).rejects.toThrow("injected fulfillment failure");
    spy.mockRestore();
    expect((await orderState(created.order.id)).order.status).toBe("draft");
    expect((await orderState(created.order.id)).fulfillments).toHaveLength(0);
  });

  it("leaves the draft untouched when the slot write fails", async () => {
    const created = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-07"));
    const create = payload.create.bind(payload);
    const spy = vi.spyOn(payload, "create").mockImplementation(async (args) => {
      if (args.collection === "service_slots") throw new Error("injected slot failure");
      return create(args as never);
    });
    await expect(confirmOrderAtomic(payload, sellerId, created.order.id)).rejects.toThrow("injected slot failure");
    spy.mockRestore();
    const state = await orderState(created.order.id);
    expect(state.order.status).toBe("draft");
    expect(state.fulfillments).toHaveLength(0);
  });

  it("returns the completed result on repeat and concurrent confirms without duplicate fulfillment", async () => {
    const created = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-04"));
    const concurrent = await Promise.all([
      confirmOrderAtomic(payload, sellerId, created.order.id),
      confirmOrderAtomic(payload, sellerId, created.order.id),
    ]);
    expect(concurrent.flatMap((result) => result.fulfillments)).toHaveLength(2);
    for (let i = 0; i < 100; i += 1) {
      await expect(confirmOrderAtomic(payload, sellerId, created.order.id)).resolves.toMatchObject({ alreadyConfirmed: true });
    }
    const state = await orderState(created.order.id);
    expect(state.order.status).toBe("confirmed");
    expect(state.fulfillments).toHaveLength(1);
    await expect(payload.create({
      collection: "fulfillments",
      data: { seller: sellerId, order: created.order.id, serviceDate: "2026-08-04", occasion: "lunch", status: "pending" },
      overrideAccess: true,
    })).rejects.toThrow();
  });

  it("reuses the winning slot when two different orders confirm the same coordinate concurrently", async () => {
    const first = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-08"));
    const secondCustomer = await payload.create({
      collection: "customers",
      data: { displayName: `并发顾客 ${suffix}`, address: "2D-18D", seller: sellerId },
      overrideAccess: true,
    });
    const second = await createDraftAtomic(payload, sellerId, operatorId, { ...draft("2026-08-08"), customer: secondCustomer.id });
    const results = await Promise.all([
      confirmOrderAtomic(payload, sellerId, first.order.id),
      confirmOrderAtomic(payload, sellerId, second.order.id),
    ]);
    expect(results).toHaveLength(2);
    expect((await orderState(first.order.id)).order.status).toBe("confirmed");
    expect((await orderState(second.order.id)).order.status).toBe("confirmed");
    const slots = await payload.find({
      collection: "service_slots",
      where: { and: [{ seller: { equals: sellerId } }, { date: { equals: "2026-08-08" } }, { occasion: { equals: "lunch" } }] },
      limit: 0,
      overrideAccess: true,
    });
    expect(slots.docs).toHaveLength(1);
  });

  it("confirms an addressless customer's draft and creates one fulfillment", async () => {
    const addresslessCustomer = await payload.create({
      collection: "customers",
      data: { displayName: `无地址顾客 ${suffix}`, seller: sellerId },
      overrideAccess: true,
    });
    const created = await createDraftAtomic(payload, sellerId, operatorId, {
      ...draft("2026-08-09"),
      customer: addresslessCustomer.id,
    });
    expect(created.order.address ?? null).toBeNull();

    await confirmOrderAtomic(payload, sellerId, created.order.id);

    const state = await orderState(created.order.id);
    expect(state.order).toMatchObject({ status: "confirmed" });
    expect(state.order.address ?? null).toBeNull();
    expect(state.fulfillments).toEqual([expect.objectContaining({ status: "pending" })]);
  });

  it("rejects an archived slot without changing the draft", async () => {
    const created = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-05"));
    await payload.create({
      collection: "service_slots",
      data: { seller: sellerId, date: "2026-08-05T00:00:00.000Z", occasion: "lunch", granularity: "occasion", status: "archived" },
      overrideAccess: true,
    });
    await expect(confirmOrderAtomic(payload, sellerId, created.order.id)).rejects.toMatchObject({ code: "slot-archived" });
    const state = await orderState(created.order.id);
    expect(state.order.status).toBe("draft");
    expect(state.fulfillments).toHaveLength(0);
  });

  it("rolls back a half-cancel and makes repeat cancellation idempotent", async () => {
    const created = await createDraftAtomic(payload, sellerId, operatorId, draft("2026-08-06"));
    await confirmOrderAtomic(payload, sellerId, created.order.id);
    const update = payload.update.bind(payload);
    const fulfillmentSpy = vi.spyOn(payload, "update").mockImplementation((async (args: Parameters<Payload["update"]>[0]) => {
      if (args.collection === "fulfillments") throw new Error("injected fulfillment cancel failure");
      return update(args as never);
    }) as never);
    await expect(cancelOrderAtomic(payload, sellerId, created.order.id)).rejects.toThrow("injected fulfillment cancel failure");
    fulfillmentSpy.mockRestore();
    expect((await orderState(created.order.id)).order.status).toBe("confirmed");

    const spy = vi.spyOn(payload, "update").mockImplementation((async (args: Parameters<Payload["update"]>[0]) => {
      if (args.collection === "orders" && "data" in args && args.data.status === "canceled") throw new Error("injected cancel failure");
      return update(args as never);
    }) as never);
    await expect(cancelOrderAtomic(payload, sellerId, created.order.id)).rejects.toThrow("injected cancel failure");
    spy.mockRestore();
    const failed = await orderState(created.order.id);
    expect(failed.order.status).toBe("confirmed");
    expect(failed.fulfillments[0]?.status).toBe("pending");

    await expect(cancelOrderAtomic(payload, sellerId, created.order.id)).resolves.toEqual({ ok: true, alreadyCanceled: false });
    await expect(cancelOrderAtomic(payload, sellerId, created.order.id)).resolves.toEqual({ ok: true, alreadyCanceled: true });
    const canceled = await orderState(created.order.id);
    expect(canceled.order.status).toBe("canceled");
    expect(canceled.fulfillments[0]?.status).toBe("canceled");
  });
});
