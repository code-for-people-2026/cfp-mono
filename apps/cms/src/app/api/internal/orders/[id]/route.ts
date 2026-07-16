import { NextResponse } from "next/server";
import { lockOrderReconciliationWrites, operatorScope, withTransaction } from "@/lib/internal";

export const dynamic = "force-dynamic";

type CustomerDoc = { id: string | number; address?: string };

const UPDATABLE_ORDER_FIELDS = ["paymentStatus", "paymentMethod", "paidAt", "date", "occasion", "note"] as const;

function selectOrderUpdateData(body: unknown) {
  const source = Object(body) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of UPDATABLE_ORDER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) data[field] = source[field];
  }
  return data;
}

/** Flatten Payload's depth population into the OrderDetail shape be consumes. */
function normalize(
  order: { id: string | number; date?: string; occasion?: string; status?: string; address?: string; customer?: CustomerDoc | string | number },
  items: Array<{ id: string | number; quantity?: number }>,
) {
  const c = order.customer;
  const obj = c && typeof c === "object" ? c : undefined;
  const id = obj?.id ?? (typeof c === "string" || typeof c === "number" ? c : 0);
  return {
    id: order.id,
    date: order.date,
    occasion: order.occasion,
    status: order.status,
    address: order.address,
    customer: { id, address: obj?.address },
    items: items.map((it) => ({ id: it.id, quantity: it.quantity ?? 0 })),
  };
}

/**
 * `GET /api/internal/orders/:id` — normalized order + items + customer (the
 * confirm/cancel load be's orderService uses). Seller-scoped; 404 if absent or
 * belongs to another tenant.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const orderRes = await payload.find({
    collection: "orders",
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    depth: 1, // populate customer (address is a flat text field now)
    overrideAccess: true,
  });
  const order = orderRes.docs[0] as { id: string | number; date?: string; occasion?: string; status?: string; customer?: CustomerDoc } | undefined;
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  const itemsRes = await payload.find({ collection: "order_items", where: { order: { equals: id } }, limit: 0, overrideAccess: true });
  return NextResponse.json(normalize(order, itemsRes.docs as Array<{ id: string | number; quantity?: number }>));
}

/**
 * `PATCH /api/internal/orders/:id` — apply ordinary payment/date/occasion/note
 * updates from be. Snapshot, ownership, lifecycle, and unknown fields never
 * reach Payload. find-then-update enforces seller scoping (404 if the order
 * isn't this seller's).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data = selectOrderUpdateData(body);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "no updatable fields" }, { status: 400 });
  if (Object.prototype.hasOwnProperty.call(data, "paymentStatus")) {
    if (data.paymentStatus !== "unpaid" && data.paymentStatus !== "paid") {
      return NextResponse.json({ error: "paymentStatus must be unpaid or paid" }, { status: 400 });
    }
    if (data.paymentStatus === "unpaid") {
      data.paidAt = null;
      data.paymentMethod = null;
    } else if (typeof data.paidAt !== "string") {
      data.paidAt = new Date().toISOString();
    }
  }
  const updated = await withTransaction(payload, async (payloadReq) => {
    await lockOrderReconciliationWrites(payload, payloadReq);
    const existing = await payload.find({
      collection: "orders",
      where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
      overrideAccess: true,
      req: payloadReq,
    });
    if (!existing.docs[0]) return undefined;
    return payload.update({ collection: "orders", id, data, overrideAccess: true, req: payloadReq });
  });
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}
