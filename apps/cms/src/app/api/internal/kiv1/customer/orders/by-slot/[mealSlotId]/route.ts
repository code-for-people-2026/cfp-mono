import { NextResponse } from "next/server";
import { customerScope } from "@/lib/kiv1-internal";
import { normalizeOrder } from "../../../../orders/route";
import { relationshipId, relationshipsOwned } from "../../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ mealSlotId: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const scope = await customerScope(req);
  if (scope instanceof NextResponse) return scope;
  const mealSlotId = relationshipId((await params).mealSlotId);
  const customerProfileId = relationshipId(new URL(req.url).searchParams.get("customerProfileId") ?? "");
  if (mealSlotId === null || customerProfileId === null) {
    return NextResponse.json({ error: "invalid-order-coordinate" }, { status: 400 });
  }
  if (!await relationshipsOwned(scope.payload, scope.sellerId, scope.openid, mealSlotId, customerProfileId)) {
    return NextResponse.json({ error: "relationship-owner-mismatch" }, { status: 409 });
  }
  const result = await scope.payload.find({
    collection: "kiv1_orders",
    where: { and: [
      { seller: { equals: scope.sellerId } }, { customerOpenid: { equals: scope.openid } },
      { mealSlot: { equals: mealSlotId } }, { customerProfile: { equals: customerProfileId } }
    ] },
    limit: 1, depth: 0, overrideAccess: true
  });
  const doc = result.docs[0];
  return NextResponse.json({ doc: doc ? normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) : null });
}
