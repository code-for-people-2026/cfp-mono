import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

type FulfillmentInput = {
  orderItem: string | number;
  serviceDate: string;
  occasion?: string;
  mode: string;
  status: string;
  assignee?: string;
  timeWindow?: string;
};

/**
 * `GET /api/internal/fulfillments[?date=&occasion=]` — the seller's fulfillments
 * (送餐 tab 的数据源：分拣 + 缺口对账都在 be 派生里算)。seller-scoped; optional
 * date/occasion filters; depth:2 populates orderItem→order so be can read each
 * fulfillment's order.address (the delivery address lives on the order, not here).
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const params = new URL(req.url).searchParams;
  const clauses: Where[] = [{ seller: { equals: sellerId } }];
  if (params.has("date")) clauses.push({ serviceDate: { equals: params.get("date") } });
  if (params.has("occasion")) clauses.push({ occasion: { equals: params.get("occasion") } });
  const res = await payload.find({ collection: "fulfillments", where: { and: clauses }, depth: 2, limit: 0, overrideAccess: true });
  return NextResponse.json({ docs: res.docs });
}

/**
 * `POST /api/internal/fulfillments` — batch-create fulfillments at confirm time
 * (one per delivery/pickup item; be skips self/onsite). `seller` stamped from JWT.
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const inputs = (await req.json().catch(() => null)) as FulfillmentInput[] | null;
  if (!Array.isArray(inputs)) return NextResponse.json({ error: "fulfillments[] required" }, { status: 400 });
  const created = [];
  for (const f of inputs) {
    created.push(await payload.create({ collection: "fulfillments", data: { ...f, seller: sellerId }, overrideAccess: true }));
  }
  return NextResponse.json(created, { status: 201 });
}

/**
 * `PATCH /api/internal/fulfillments` — batch set fields on all fulfillments whose
 * `orderItem` ∈ ids (cancel sets status=canceled). Seller-scoped via the where.
 */
export async function PATCH(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const body = (await req.json().catch(() => null)) as { orderItemIn?: Array<string | number>; set?: Record<string, unknown> } | null;
  if (!body?.orderItemIn || !body.set) return NextResponse.json({ error: "orderItemIn, set required" }, { status: 400 });
  const res = await payload.update({
    collection: "fulfillments",
    where: { and: [{ seller: { equals: sellerId } }, { orderItem: { in: body.orderItemIn } }] },
    data: body.set,
    overrideAccess: true,
  });
  return NextResponse.json({ ok: true, updated: res.docs.length });
}
