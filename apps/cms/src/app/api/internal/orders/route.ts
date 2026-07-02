import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope, ownedBy } from "@/lib/internal";

export const dynamic = "force-dynamic";

type DraftItem = { offering: string | number; quantity: number; unitPriceCents?: number; note?: string };
type DraftBody = {
  customer: string | number;
  date: string;
  occasion: string;
  source: string;
  note?: string;
  idempotencyKey?: string;
  items: DraftItem[];
  totalCents: number;
};

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
  if (!body || body.customer === undefined || !body.date || !body.occasion || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "customer, date, occasion, items required" }, { status: 400 });
  }
  // Tenant-ownership guard (Codex P1): overrideAccess writes carry no req.user,
  // so assertSameTenantRefs can't fire — validate every ref belongs to this
  // seller before storing (customer + each offering), else depth reads leak.
  // Fetch the customer seller-scoped (one read doubles as the ownership check
  // AND the source for the frozen address snapshot — like e-commerce, the order
  // copies the customer's address at creation and never changes it after).
  const customerDoc = await payload.find({
    collection: "customers",
    where: { and: [{ id: { equals: body.customer } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
  });
  if (!customerDoc.docs[0]) return NextResponse.json({ error: "customer not owned" }, { status: 403 });
  const offeringIds = [...new Set(body.items.map((it) => it.offering))];
  for (const oid of offeringIds) {
    if (!(await ownedBy(payload, "offerings", oid, sellerId))) {
      return NextResponse.json({ error: "offering not owned" }, { status: 403 });
    }
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
      // Frozen snapshot of the customer's delivery address at order-creation.
      address: (customerDoc.docs[0] as { address?: string } | undefined)?.address,
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
