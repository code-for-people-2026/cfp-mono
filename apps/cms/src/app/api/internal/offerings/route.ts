import { offeringCreateSchema } from "@cfp/kith-inn-shared/schemas";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/offerings` — seller-scoped offerings read (generic, no
 * active/kind filter — domain filtering happens at the BE layer). The BE
 * offerings route keeps `kind=component` (+ FE partitions by `active`), and
 * `routes/menu.ts` filters `active && component` itself.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const res = await payload.find({
    collection: "offerings",
    where: { seller: { equals: sellerId } },
    overrideAccess: true,
    limit: 0, // disable default pagination (limit=10) — return the full pool
  });
  return NextResponse.json({ docs: res.docs });
}

/**
 * `POST /api/internal/offerings` — create a component dish. `kind` is forced to
 * "component" (菜品池 only manages components), `active=true`, `seller` stamped
 * from the JWT (seller-token passthrough, §3.1). M1 write whitelist = name +
 * mainIngredient + category (validated by offeringCreateSchema; extras dropped).
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const parsed = offeringCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "name and category required" }, { status: 400 });
  const doc = await payload.create({
    collection: "offerings",
    data: { ...parsed.data, kind: "component", active: true, seller: sellerId },
    overrideAccess: true,
  });
  return NextResponse.json({ doc }, { status: 201 });
}
