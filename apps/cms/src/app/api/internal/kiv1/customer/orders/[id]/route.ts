import { cmsCustomerOrderUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { customerWriteScope } from "@/lib/kiv1-internal";
import { normalizeOrder } from "../../../orders/route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext) {
  const scope = await customerWriteScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = cmsCustomerOrderUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid-customer-order-update" }, { status: 422 });
  const { id } = await params;
  const owned = await scope.payload.find({
    collection: "kiv1_orders",
    where: { and: [
      { id: { equals: id } }, { seller: { equals: scope.sellerId } },
      { customerOpenid: { equals: scope.openid } }, { source: { equals: "customer-card" } }
    ] },
    limit: 1, depth: 0, overrideAccess: true
  });
  if (!owned.docs[0]) return NextResponse.json({ error: "customer-order-not-found" }, { status: 404 });
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_orders", id, data: parsed.data, overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) });
  } catch {
    return NextResponse.json({ error: "customer-order-update-failed" }, { status: 500 });
  }
}
