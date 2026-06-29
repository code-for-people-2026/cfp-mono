import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

type DraftItem = { offering: string | number; mealOccasion?: string; quantity: number; unitPriceCents?: number; note?: string };
type DraftBody = {
  customer: string | number;
  date: string;
  source: string;
  note?: string;
  idempotencyKey?: string;
  items: DraftItem[];
  totalCents: number;
};

/**
 * `GET /api/internal/orders[?date=&status=]` — the seller's order 台账 (seller-
 * scoped; optional date/status filters). depth:1 populates `customer`.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const params = new URL(req.url).searchParams;
  const clauses: Where[] = [{ seller: { equals: sellerId } }];
  if (params.has("date")) clauses.push({ date: { equals: params.get("date") } });
  if (params.has("status")) clauses.push({ status: { equals: params.get("status") } });
  const res = await payload.find({ collection: "orders", where: { and: clauses }, depth: 1, sort: "-date", overrideAccess: true });
  return NextResponse.json({ docs: res.docs });
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
  if (!body || body.customer === undefined || !body.date || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "customer, date, items required" }, { status: 400 });
  }
  const order = await payload.create({
    collection: "orders",
    data: {
      customer: body.customer,
      date: body.date,
      source: body.source,
      status: "draft",
      placedAt: new Date().toISOString(),
      note: body.note,
      idempotencyKey: body.idempotencyKey,
      totalCents: body.totalCents,
      paymentStatus: "unpaid",
      createdBy: operatorId,
      seller: sellerId,
    },
    overrideAccess: true,
  });
  const items = [];
  for (const it of body.items) {
    items.push(
      await payload.create({
        collection: "order_items",
        data: {
          order: order.id,
          offering: it.offering,
          mealOccasion: it.mealOccasion,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          note: it.note,
          seller: sellerId,
        },
        overrideAccess: true,
      }),
    );
  }
  return NextResponse.json({ order, items }, { status: 201 });
}
