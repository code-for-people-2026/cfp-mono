import type { Fulfillment, Order, OrderItem, ServiceSlot } from "@cfp/kith-inn-shared";
import type { BasePayload, PayloadRequest, Where } from "payload";
import { ownedBy, withTransaction } from "./internal";

export type DraftItem = { offering: string | number; quantity: number; unitPriceCents?: number; note?: string };
export type DraftBody = {
  customer: string | number;
  date: string;
  occasion: string;
  source: string;
  note?: string;
  idempotencyKey?: string;
  items: DraftItem[];
  totalCents: number;
};

export class OrderLifecycleError extends Error {
  constructor(
    public code: "empty-order" | "inconsistent-order" | "not-draft" | "not-found" | "slot-archived",
    public status = code === "not-found" ? 404 : 409,
  ) {
    super(code);
    this.name = "OrderLifecycleError";
  }
}

type OrderDoc = Order & { date: string; occasion: string; status: string };
type ConfirmResult = { slots: ServiceSlot[]; fulfillments: Fulfillment[]; alreadyConfirmed: boolean };

const scopedOrder = async (payload: BasePayload, sellerId: string | number, id: string | number, req?: PayloadRequest): Promise<OrderDoc | undefined> =>
  (await payload.find({
    collection: "orders",
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
    req,
  })).docs[0] as OrderDoc | undefined;

const slotWhere = (sellerId: string | number, order: OrderDoc): Where => ({
  and: [
    { seller: { equals: sellerId } },
    { date: { equals: order.date } },
    { occasion: { equals: order.occasion } },
  ],
});

async function completedConfirmation(
  payload: BasePayload,
  sellerId: string | number,
  id: string | number,
  req?: PayloadRequest,
): Promise<ConfirmResult | undefined> {
  const order = await scopedOrder(payload, sellerId, id, req);
  if (order?.status !== "confirmed") return undefined;
  // One transaction request maps to one pg client; keep its queries sequential.
  const slots = await payload.find({ collection: "service_slots", where: slotWhere(sellerId, order), limit: 1, overrideAccess: true, req });
  const fulfillments = await payload.find({
    collection: "fulfillments",
    where: { and: [{ seller: { equals: sellerId } }, { order: { equals: id } }] },
    limit: 2,
    overrideAccess: true,
    req,
  });
  if (slots.docs.length !== 1 || fulfillments.docs.length !== 1) throw new OrderLifecycleError("inconsistent-order");
  return {
    slots: slots.docs as ServiceSlot[],
    fulfillments: fulfillments.docs as Fulfillment[],
    alreadyConfirmed: true,
  };
}

export async function createDraftAtomic(
  payload: BasePayload,
  sellerId: string | number,
  operatorId: string | number,
  body: DraftBody,
): Promise<{ order: Order; items: OrderItem[] }> {
  return withTransaction(payload, async (req) => {
    const customerDoc = await payload.find({
      collection: "customers",
      where: { and: [{ id: { equals: body.customer } }, { seller: { equals: sellerId } }] },
      limit: 1,
      overrideAccess: true,
      req,
    });
    if (!customerDoc.docs[0]) throw new OrderLifecycleError("not-found", 403);
    for (const oid of [...new Set(body.items.map((item) => item.offering))]) {
      if (!(await ownedBy(payload, "offerings", oid, sellerId, req))) throw new OrderLifecycleError("not-found", 403);
    }
    const order = await payload.create({
      collection: "orders",
      data: {
        customer: body.customer,
        date: body.date,
        occasion: body.occasion,
        source: body.source,
        status: "draft",
        placedAt: new Date().toISOString(),
        note: body.note,
        idempotencyKey: body.idempotencyKey,
        totalCents: body.totalCents,
        address: (customerDoc.docs[0] as { address?: string }).address,
        paymentStatus: "unpaid",
        createdBy: operatorId,
        seller: sellerId,
      },
      overrideAccess: true,
      req,
    });
    const items: OrderItem[] = [];
    for (const item of body.items) {
      items.push(await payload.create({
        collection: "order_items",
        data: {
          order: order.id,
          offering: item.offering,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          note: item.note,
          seller: sellerId,
        },
        overrideAccess: true,
        req,
      }) as OrderItem);
    }
    return { order: order as Order, items };
  });
}

export async function confirmOrderAtomic(payload: BasePayload, sellerId: string | number, id: string | number): Promise<ConfirmResult> {
  try {
    return await withTransaction(payload, async (req) => {
      const existing = await completedConfirmation(payload, sellerId, id, req);
      if (existing) return existing;
      const order = await scopedOrder(payload, sellerId, id, req);
      if (!order) throw new OrderLifecycleError("not-found");
      if (order.status !== "draft") throw new OrderLifecycleError("not-draft");
      const items = await payload.find({
        collection: "order_items",
        where: { and: [{ seller: { equals: sellerId } }, { order: { equals: id } }] },
        limit: 1,
        overrideAccess: true,
        req,
      });
      if (items.docs.length === 0) throw new OrderLifecycleError("empty-order");

      const found = (await payload.find({ collection: "service_slots", where: slotWhere(sellerId, order), limit: 1, overrideAccess: true, req })).docs[0] as ServiceSlot | undefined;
      if (found?.status === "archived") throw new OrderLifecycleError("slot-archived");
      const slot = found
        ? found.status === "open"
          ? found
          : await payload.update({ collection: "service_slots", id: found.id, data: { status: "open" }, overrideAccess: true, req })
        : await payload.create({
            collection: "service_slots",
            data: { date: order.date, occasion: order.occasion, granularity: "occasion", status: "open", seller: sellerId },
            overrideAccess: true,
            req,
          });
      const fulfillment = await payload.create({
        collection: "fulfillments",
        data: { order: order.id, serviceDate: order.date, occasion: order.occasion, status: "pending", seller: sellerId },
        overrideAccess: true,
        req,
      });
      await payload.update({ collection: "orders", id, data: { status: "confirmed" }, overrideAccess: true, req });
      return { slots: [slot as ServiceSlot], fulfillments: [fulfillment as Fulfillment], alreadyConfirmed: false };
    });
  } catch (error) {
    const completed = await completedConfirmation(payload, sellerId, id);
    if (completed) return completed;
    throw error;
  }
}

export async function cancelOrderAtomic(
  payload: BasePayload,
  sellerId: string | number,
  id: string | number,
): Promise<{ ok: true; alreadyCanceled: boolean }> {
  try {
    return await withTransaction(payload, async (req) => {
      const order = await scopedOrder(payload, sellerId, id, req);
      if (!order) throw new OrderLifecycleError("not-found");
      if (order.status === "canceled") return { ok: true, alreadyCanceled: true };
      await payload.update({
        collection: "fulfillments",
        where: { and: [{ seller: { equals: sellerId } }, { order: { equals: id } }] },
        data: { status: "canceled" },
        overrideAccess: true,
        req,
      });
      await payload.update({ collection: "orders", id, data: { status: "canceled" }, overrideAccess: true, req });
      return { ok: true, alreadyCanceled: false };
    });
  } catch (error) {
    const order = await scopedOrder(payload, sellerId, id);
    if (order?.status === "canceled") return { ok: true, alreadyCanceled: true };
    throw error;
  }
}
