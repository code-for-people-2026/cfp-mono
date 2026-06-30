import { NextResponse } from "next/server";
import type { Where } from "payload";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/customers` — the seller's customers (optional `?name=`
 * substring on displayName). Seller-scoped via the where; depth 1 populates
 * `defaultAddress` so be can resolve a name → customer + address.
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
    depth: 1,
    limit: 0,
    overrideAccess: true,
  });
  return NextResponse.json({ docs: res.docs });
}
