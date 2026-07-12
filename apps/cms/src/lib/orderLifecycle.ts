import type { Fulfillment, Order, OrderItem, OrderReconciliationRequest, OrderReconciliationResult, ServiceSlot } from "@cfp/kith-inn-shared";
import { fingerprintActiveOrders, type ActiveOrderFingerprintInput } from "@cfp/kith-inn-shared/orderReconciliation";
import type { BasePayload, PayloadRequest, Where } from "payload";
import { lockOrderReconciliationWrites, ownedBy, withTransaction } from "./internal";

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
    public code: "empty-order" | "inconsistent-order" | "not-draft" | "not-found" | "slot-archived" | "invalid-reconciliation" | "not-owned" | "stale-preview" | "settled-order",
    public status = code === "invalid-reconciliation" ? 400 : code === "not-owned" ? 403 : code === "not-found" ? 404 : 409,
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
    await lockOrderReconciliationWrites(payload, req);
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
  const confirmOnce = () => withTransaction(payload, async (req) => {
    await lockOrderReconciliationWrites(payload, req);
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

  try {
    return await confirmOnce();
  } catch (error) {
    const completed = await completedConfirmation(payload, sellerId, id);
    if (completed) return completed;
    const order = await scopedOrder(payload, sellerId, id);
    if (order?.status === "draft") {
      const slot = await payload.find({ collection: "service_slots", where: slotWhere(sellerId, order), limit: 1, overrideAccess: true });
      // A different order can win the first-create race for this coordinate.
      // Once its open slot is visible, retry this order exactly once and reuse it.
      if ((slot.docs[0] as ServiceSlot | undefined)?.status === "open") return confirmOnce();
    }
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
      await lockOrderReconciliationWrites(payload, req);
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

type ReconcileOrder = ActiveOrderFingerprintInput & {
  customer: string | number | { id: string | number; displayName?: string };
  status: "draft" | "confirmed";
};

const relationId = (value: string | number | { id: string | number }) => typeof value === "object" ? value.id : value;
const dayOnly = (value: string) => value.split("T")[0]!;
const coordinate = (customer: string | number, date: string, occasion: string) => `${String(customer)}|${dayOnly(date)}|${occasion}`;
const normalizedCustomerName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const operationPrefix = (key: string) => `reconcile:${key}:`;

async function loadActiveOrders(
  payload: BasePayload,
  sellerId: string | number,
  scope: OrderReconciliationRequest["scope"],
  req?: PayloadRequest,
): Promise<ReconcileOrder[]> {
  const found = await payload.find({
    collection: "orders",
    where: {
      and: [
        { seller: { equals: sellerId } },
        { status: { in: ["draft", "confirmed"] } },
        { or: scope.map((entry) => ({ and: [{ date: { equals: entry.date } }, { occasion: { equals: entry.occasion } }] } as Where)) },
      ],
    },
    depth: 1,
    limit: 0,
    overrideAccess: true,
    req,
  });
  if (found.docs.length === 0) return [];
  const items = await payload.find({
    collection: "order_items",
    where: { and: [{ seller: { equals: sellerId } }, { order: { in: found.docs.map((order) => order.id) } }] },
    limit: 0,
    overrideAccess: true,
    req,
  });
  return found.docs.map((order) => ({
    id: order.id,
    customer: order.customer as ReconcileOrder["customer"],
    date: order.date,
    occasion: order.occasion as "lunch" | "dinner",
    status: order.status as "draft" | "confirmed",
    paymentStatus: order.paymentStatus as string,
    updatedAt: order.updatedAt,
    items: items.docs.filter((item) => String(relationId(item.order as string | number | { id: string | number })) === String(order.id)).map((item) => ({
      id: item.id,
      offering: item.offering as string | number | { id: string | number },
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents ?? undefined,
    })),
  }));
}

async function completedReconciliation(
  payload: BasePayload,
  sellerId: string | number,
  operationKey: string,
  req?: PayloadRequest,
): Promise<OrderReconciliationResult | undefined> {
  const found = await payload.find({
    collection: "orders",
    where: { and: [{ seller: { equals: sellerId } }, { idempotencyKey: { contains: operationPrefix(operationKey) } }] },
    limit: 0,
    overrideAccess: true,
    req,
  });
  if (found.docs.length === 0) return undefined;
  const result: OrderReconciliationResult = { ok: true, created: [], updated: [], canceled: [], unchanged: [], alreadyApplied: true };
  for (const order of found.docs) {
    const suffix = String(order.idempotencyKey).slice(operationPrefix(operationKey).length).split(":");
    const [kind, before, after] = suffix;
    if (kind === "c") result.created.push({ orderId: order.id });
    else if (kind === "u") result.updated.push({ orderId: order.id, beforeQuantity: Number(before), afterQuantity: Number(after) });
    else if (kind === "x") result.canceled.push({ orderId: order.id });
    else if (kind === "n") result.unchanged.push({ orderId: order.id });
  }
  return result;
}

const marker = (operationKey: string, kind: "c" | "u" | "x" | "n", before: number, after: number, customer: string | number, date: string, occasion: string) =>
  `${operationPrefix(operationKey)}${kind}:${before}:${after}:${String(customer)}:${date}:${occasion}`;

async function assertFulfillmentConsistency(
  payload: BasePayload,
  sellerId: string | number,
  order: ReconcileOrder,
  req: PayloadRequest,
): Promise<Fulfillment | undefined> {
  const fulfillments = await payload.find({
    collection: "fulfillments",
    where: { and: [{ seller: { equals: sellerId } }, { order: { equals: order.id } }] },
    limit: 2,
    overrideAccess: true,
    req,
  });
  if ((order.status === "confirmed" && fulfillments.docs.length !== 1) || (order.status === "draft" && fulfillments.docs.length !== 0)) {
    throw new OrderLifecycleError("inconsistent-order");
  }
  return fulfillments.docs[0] as Fulfillment | undefined;
}

const assertReconciliationMutable = (order: ReconcileOrder, fulfillment?: Fulfillment) => {
  if (order.paymentStatus !== "unpaid" || (order.status === "confirmed" && fulfillment?.status !== "pending")) {
    throw new OrderLifecycleError("settled-order");
  }
};

/** Apply a server-generated reconciliation in one transaction; no write happens before fingerprint validation. */
export async function reconcileOrdersAtomic(
  payload: BasePayload,
  sellerId: string | number,
  operatorId: string | number,
  body: OrderReconciliationRequest,
): Promise<OrderReconciliationResult> {
  const apply = () => withTransaction(payload, async (req) => {
    if ((body.mode === "increment" && (body.operation === undefined || body.scope.length !== 1 || body.candidates.length !== 1))
      || (body.mode === "snapshot" && body.operation !== undefined)) throw new OrderLifecycleError("invalid-reconciliation");
    await lockOrderReconciliationWrites(payload, req);
    const completed = await completedReconciliation(payload, sellerId, body.operationKey, req);
    if (completed) return completed;
    const scopeActive = await loadActiveOrders(payload, sellerId, body.scope, req);
    const active = body.mode === "snapshot" ? scopeActive : scopeActive.filter((order) => {
      const candidate = body.candidates[0]!;
      return candidate.customer !== undefined && coordinate(relationId(order.customer), order.date, order.occasion)
        === coordinate(candidate.customer, candidate.date, candidate.occasion);
    });
    if (fingerprintActiveOrders(active) !== body.expectedFingerprint) throw new OrderLifecycleError("stale-preview");
    const current = new Map<string, ReconcileOrder>();
    for (const order of active) {
      const key = coordinate(relationId(order.customer), order.date, order.occasion);
      if (order.items.length !== 1 || current.has(key)) throw new OrderLifecycleError("inconsistent-order");
      current.set(key, order);
    }

    const offeringPrices = new Map<string, number | undefined>();
    const offerings = [...new Set(body.candidates.map((candidate) => candidate.offering))];
    for (const offering of offerings) {
      const found = await payload.find({ collection: "offerings", where: { and: [{ id: { equals: offering } }, { seller: { equals: sellerId } }] }, limit: 1, overrideAccess: true, req });
      const doc = found.docs[0];
      if (!doc) throw new OrderLifecycleError("not-owned");
      if (doc.kind !== "combo-meal" || doc.active === false) throw new OrderLifecycleError("stale-preview");
      offeringPrices.set(String(offering), doc.priceCents ?? undefined);
    }
    const seller = await payload.findByID({ collection: "sellers", id: sellerId, overrideAccess: true, req });
    const customerAddresses = new Map<string, string | undefined>();
    const newCustomerAddresses = new Map<string, string>();
    const newCustomerNames = new Set<string>();
    const candidateKeys = new Set<string>();
    const scopeKeys = new Set(body.scope.map((entry) => `${entry.date}|${entry.occasion}`));
    if (scopeKeys.size !== body.scope.length) throw new OrderLifecycleError("invalid-reconciliation");
    for (const candidate of body.candidates) {
      if (candidate.totalCents !== candidate.quantity * candidate.unitPriceCents) throw new OrderLifecycleError("invalid-reconciliation");
      const existing = candidate.customer === undefined
        ? undefined
        : current.get(coordinate(candidate.customer, candidate.date, candidate.occasion));
      const existingItem = existing?.items[0];
      const finalQuantity = body.mode === "increment" && body.operation === "add" && existingItem
        ? existingItem.quantity + candidate.quantity
        : candidate.quantity;
      const preservesHistoricalPrice = existingItem?.quantity === finalQuantity
        && String(relationId(existingItem.offering)) === String(candidate.offering)
        && existingItem.unitPriceCents === candidate.unitPriceCents;
      if (candidate.unitPriceCents !== (offeringPrices.get(String(candidate.offering)) ?? seller.defaultPriceCents) && !preservesHistoricalPrice) {
        throw new OrderLifecycleError("stale-preview");
      }
      const identity = candidate.customer !== undefined
        ? String(candidate.customer)
        : `new:${normalizedCustomerName(candidate.newCustomer!.displayName)}`;
      const candidateKey = coordinate(identity, candidate.date, candidate.occasion);
      if (candidateKeys.has(candidateKey)) throw new OrderLifecycleError("invalid-reconciliation");
      candidateKeys.add(candidateKey);
      if (candidate.customer !== undefined) {
        const found = await payload.find({ collection: "customers", where: { and: [{ id: { equals: candidate.customer } }, { seller: { equals: sellerId } }] }, limit: 1, overrideAccess: true, req });
        if (!found.docs[0]) throw new OrderLifecycleError("not-owned");
        customerAddresses.set(String(candidate.customer), found.docs[0].address ?? undefined);
      } else if (candidate.newCustomer!.address && !newCustomerAddresses.has(identity.slice(4))) {
        newCustomerAddresses.set(identity.slice(4), candidate.newCustomer!.address);
      }
      if (candidate.customer === undefined) newCustomerNames.add(identity.slice(4));
    }
    if (newCustomerNames.size > 0) {
      const latestCustomers = await payload.find({ collection: "customers", where: { seller: { equals: sellerId } }, limit: 0, overrideAccess: true, req });
      if (latestCustomers.docs.some((customer) => newCustomerNames.has(normalizedCustomerName(customer.displayName)))) {
        throw new OrderLifecycleError("stale-preview");
      }
    }

    const fulfillments = new Map<string, Fulfillment>();
    for (const order of active) {
      const fulfillment = await assertFulfillmentConsistency(payload, sellerId, order, req);
      if (fulfillment) fulfillments.set(String(order.id), fulfillment);
    }

    const result: OrderReconciliationResult = { ok: true, created: [], updated: [], canceled: [], unchanged: [] };
    const newCustomers = new Map<string, { id: string | number; address?: string }>();
    for (const candidate of body.candidates) {
      let customer: string | number;
      let address: string | undefined;
      if (candidate.customer !== undefined) {
        customer = candidate.customer;
        address = customerAddresses.get(String(customer));
      } else {
        const name = normalizedCustomerName(candidate.newCustomer!.displayName);
        let created = newCustomers.get(name);
        if (!created) {
          const doc = await payload.create({
            collection: "customers",
            data: { displayName: candidate.newCustomer!.displayName, address: newCustomerAddresses.get(name), seller: sellerId },
            overrideAccess: true,
            req,
          });
          created = { id: doc.id, address: doc.address ?? undefined };
          newCustomers.set(name, created);
        }
        customer = created.id;
        address = created.address;
      }
      const key = coordinate(customer, candidate.date, candidate.occasion);
      const existing = current.get(key);
      const finalQuantity = body.mode === "increment" && body.operation === "add" && existing
        ? existing.items[0]!.quantity + candidate.quantity
        : candidate.quantity;
      const finalTotalCents = finalQuantity * candidate.unitPriceCents;
      if (!existing) {
        const order = await payload.create({
          collection: "orders",
          data: {
            customer,
            date: candidate.date,
            occasion: candidate.occasion,
            source: body.mode === "snapshot" ? "chat-paste" : "manual",
            status: "draft",
            placedAt: new Date().toISOString(),
            totalCents: finalTotalCents,
            address,
            paymentStatus: "unpaid",
            idempotencyKey: marker(body.operationKey, "c", 0, finalQuantity, candidate.customer ?? `new-${normalizedCustomerName(candidate.newCustomer!.displayName)}`, candidate.date, candidate.occasion),
            createdBy: operatorId,
            seller: sellerId,
          },
          overrideAccess: true,
          req,
        });
        await payload.create({ collection: "order_items", data: { order: order.id, offering: candidate.offering, quantity: finalQuantity, unitPriceCents: candidate.unitPriceCents, seller: sellerId }, overrideAccess: true, req });
        result.created.push({ orderId: order.id });
        continue;
      }
      current.delete(key);
      const existingItem = existing.items[0]!;
      const unchanged = existingItem.quantity === finalQuantity
        && String(relationId(existingItem.offering)) === String(candidate.offering);
      if (unchanged) {
        await payload.update({ collection: "orders", id: existing.id, data: { idempotencyKey: marker(body.operationKey, "n", finalQuantity, finalQuantity, customer, candidate.date, candidate.occasion) }, overrideAccess: true, req });
        result.unchanged.push({ orderId: existing.id });
        continue;
      }
      assertReconciliationMutable(existing, fulfillments.get(String(existing.id)));
      await payload.delete({ collection: "order_items", id: existingItem.id, overrideAccess: true, req });
      await payload.create({ collection: "order_items", data: { order: existing.id, offering: candidate.offering, quantity: finalQuantity, unitPriceCents: candidate.unitPriceCents, seller: sellerId }, overrideAccess: true, req });
      await payload.update({ collection: "orders", id: existing.id, data: { totalCents: finalTotalCents, idempotencyKey: marker(body.operationKey, "u", existingItem.quantity, finalQuantity, customer, candidate.date, candidate.occasion) }, overrideAccess: true, req });
      result.updated.push({ orderId: existing.id, beforeQuantity: existingItem.quantity, afterQuantity: finalQuantity });
    }

    for (const existing of body.mode === "snapshot" ? current.values() : []) {
      assertReconciliationMutable(existing, fulfillments.get(String(existing.id)));
      if (existing.status === "confirmed") {
        await payload.update({ collection: "fulfillments", where: { and: [{ seller: { equals: sellerId } }, { order: { equals: existing.id } }] }, data: { status: "canceled" }, overrideAccess: true, req });
      }
      await payload.update({ collection: "orders", id: existing.id, data: { status: "canceled", idempotencyKey: marker(body.operationKey, "x", existing.items[0]!.quantity, 0, relationId(existing.customer), existing.date, existing.occasion) }, overrideAccess: true, req });
      result.canceled.push({ orderId: existing.id });
    }
    return result;
  });

  try {
    return await apply();
  } catch (error) {
    const completed = await completedReconciliation(payload, sellerId, body.operationKey);
    if (completed) return completed;
    throw error;
  }
}
