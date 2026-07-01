import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

type CustomerBody = { displayName?: string; address?: string; kind?: string };

/**
 * `GET /api/internal/customers` — the seller's customers (optional `?name=`
 * substring on displayName). Seller-scoped via the where; `address` is now a
 * flat text field on the doc (no relationship to populate), so depth 0.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const params = new URL(req.url).searchParams;
  const clauses: Where[] = [{ seller: { equals: sellerId } }];
  if (params.has("name")) clauses.push({ displayName: { contains: params.get("name") } });
  const res = await payload.find({
    collection: "customers",
    where: { and: clauses },
    depth: 0,
    limit: 0,
    overrideAccess: true,
  });
  return NextResponse.json({ docs: res.docs });
}

/**
 * `POST /api/internal/customers` — create a customer (桃子 confirms a new 接龙
 * name). `seller` stamped from the JWT (seller-token passthrough — no admin key,
 * §3.1). `address` is free-form text (e.g. "3e23a").
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const body = (await req.json().catch(() => null)) as CustomerBody | null;
  if (!body || !body.displayName) {
    return NextResponse.json({ error: "displayName required" }, { status: 400 });
  }
  const created = await payload.create({
    collection: "customers",
    data: {
      displayName: body.displayName,
      address: body.address,
      kind: body.kind ?? "regular",
      seller: sellerId,
    },
    overrideAccess: true,
  });
  return NextResponse.json(created, { status: 201 });
}
