import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/seller` — the operator's seller config (defaultPriceCents,
 * enabledModules, moduleSettings). Drives be pricing, the menu core, and the
 * agent-tool manifest. JWT-verified; read scoped to the JWT's sellerId.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const res = await payload.findByID({ collection: "sellers", id: sellerId, overrideAccess: true });
  if (!res) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(res);
}
