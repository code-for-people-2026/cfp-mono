import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";
import { createDraftAtomic, OrderLifecycleError, type DraftBody } from "@/lib/orderLifecycle";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/orders[?date=&occasion=&status=]` — the seller's order 台账
 * (seller-scoped; optional filters). depth:1 populates `customer`.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const params = new URL(req.url).searchParams;
  const clauses: Where[] = [{ seller: { equals: sellerId } }];
  if (params.has("date")) clauses.push({ date: { equals: params.get("date") } });
  if (params.has("occasion")) clauses.push({ occasion: { equals: params.get("occasion") } });
  if (params.has("status")) clauses.push({ status: { equals: params.get("status") } });
  const res = await payload.find({ collection: "orders", where: { and: clauses }, depth: 1, sort: "-date", limit: 0, overrideAccess: true });
  const orderIds = res.docs.map((o) => o.id);
  if (orderIds.length === 0) return NextResponse.json({ docs: [] });
  const items = await payload.find({
    collection: "order_items",
    where: { and: [{ seller: { equals: sellerId } }, { order: { in: orderIds } }] },
    limit: 0,
    overrideAccess: true,
  });
  const byOrder = new Map<string, unknown[]>();
  for (const it of items.docs as Array<{ order?: { id?: string | number } | string | number }>) {
    const id = typeof it.order === "object" ? it.order?.id : it.order;
    if (id === undefined) continue;
    const key = String(id);
    byOrder.set(key, [...(byOrder.get(key) ?? []), it]);
  }
  return NextResponse.json({ docs: res.docs.map((o) => ({ ...o, items: byOrder.get(String(o.id)) ?? [] })) });
}

/**
 * `POST /api/internal/orders` — create a draft order + its items in one call.
 * `status=draft` (zero side effects per §3.3 ①); `seller` + `createdBy` stamped
 * from the JWT. Prices are already snapshotted by be (pricing.ts).
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, operatorId, payload } = scope;
  const body = (await req.json().catch(() => null)) as DraftBody | null;
  if (!body || body.customer === undefined || !body.date || !body.occasion || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "customer, date, occasion, items required" }, { status: 400 });
  }
  try {
    const result = await createDraftAtomic(payload, sellerId, operatorId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
