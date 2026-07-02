import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope, ownedBy } from "@/lib/internal";

export const dynamic = "force-dynamic";

type FulfillmentInput = {
  order: string | number;
  serviceDate: string;
  occasion?: string;
  status: string;
};

/**
 * `GET /api/internal/fulfillments[?date=&occasion=]` — the seller's fulfillments
 * (送餐 tab 的数据源：分拣 + 缺口对账都在 be 派生里算)。seller-scoped; optional
 * date/occasion filters; depth:1 populates order so be can read order.address.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const params = new URL(req.url).searchParams;
  const clauses: Where[] = [{ seller: { equals: sellerId } }];
  if (params.has("date")) clauses.push({ serviceDate: { equals: params.get("date") } });
  if (params.has("occasion")) clauses.push({ occasion: { equals: params.get("occasion") } });
  const res = await payload.find({ collection: "fulfillments", where: { and: clauses }, depth: 1, limit: 0, overrideAccess: true });
  return NextResponse.json({ docs: res.docs });
}

/**
 * `POST /api/internal/fulfillments` — batch-create fulfillments at confirm time
 * (one per order). `seller` stamped from JWT.
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const inputs = (await req.json().catch(() => null)) as FulfillmentInput[] | null;
  if (!Array.isArray(inputs)) return NextResponse.json({ error: "fulfillments[] required" }, { status: 400 });
  const created = [];
  for (const f of inputs) {
    if (!(await ownedBy(payload, "orders", f.order, sellerId))) {
      return NextResponse.json({ error: "order not owned" }, { status: 403 });
    }
    created.push(await payload.create({ collection: "fulfillments", data: { ...f, seller: sellerId }, overrideAccess: true }));
  }
  return NextResponse.json(created, { status: 201 });
}

/**
 * `PATCH /api/internal/fulfillments` — batch set fields by fulfillment ids or by
 * order ids (cancel sets status=canceled). Seller-scoped via the where.
 */
export async function PATCH(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const body = (await req.json().catch(() => null)) as { ids?: Array<string | number>; orderIn?: Array<string | number>; set?: Record<string, unknown> } | null;
  if (!body?.set || (!body.ids && !body.orderIn)) return NextResponse.json({ error: "ids or orderIn, set required" }, { status: 400 });
  const target: Where = body.ids ? { id: { in: body.ids } } : { order: { in: body.orderIn ?? [] } };
  const res = await payload.update({
    collection: "fulfillments",
    where: { and: [{ seller: { equals: sellerId } }, target] },
    data: body.set,
    overrideAccess: true,
  });
  return NextResponse.json({ ok: true, updated: res.docs.length });
}
