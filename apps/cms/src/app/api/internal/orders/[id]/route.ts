import { NextResponse } from "next/server";
import { lockOrderReconciliationWrites, operatorScope, withTransaction } from "@/lib/internal";

export const dynamic = "force-dynamic";

type CustomerDoc = { id: string | number; address?: string };

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
 * `PATCH /api/internal/orders/:id` — apply simple field updates (status/payment/
 * date/note) from be. find-then-update to enforce seller scoping (404 if the
 * order isn't this seller's). be guarantees `status` only changes via the
 * lifecycle (confirm/cancel), never a direct FE PATCH.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const data = (await req.json().catch(() => ({}))) as Record<string, unknown>;
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
