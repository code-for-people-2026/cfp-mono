import { cmsCustomerOrderUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { customerWriteScope, withCustomerOrderLock } from "@/lib/kiv1-internal";
import { normalizeOrder } from "../../../orders/route";
import { batchPublicId, databaseId, writeRelationshipsAvailable } from "../route";

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
  const selectedBatch = batchPublicId(req);
  if (!selectedBatch) return NextResponse.json({ error: "invalid-batch-public-id" }, { status: 400 });
  const expectedStatus = new URL(req.url).searchParams.get("expectedStatus");
  if (expectedStatus !== "draft" && expectedStatus !== "canceled") {
    return NextResponse.json({ error: "invalid-expected-order-status" }, { status: 400 });
  }
  const { id } = await params;
  const storedOrderId = databaseId(id);
  if (!storedOrderId) return NextResponse.json({ error: "customer-order-not-found" }, { status: 404 });
  try {
    return await withCustomerOrderLock(scope.payload, storedOrderId, async (transactionReq) => {
      const owned = await scope.payload.find({
        collection: "kiv1_orders",
        where: { and: [
          { id: { equals: storedOrderId } }, { seller: { equals: scope.sellerId } },
          { customerOpenid: { equals: scope.openid } }, { source: { equals: "customer-card" } }
        ] },
        limit: 1, depth: 0, overrideAccess: true, req: transactionReq
      });
      if (!owned.docs[0]) {
        return NextResponse.json({ error: "customer-order-not-found" }, { status: 404 });
      }
      if ((owned.docs[0] as { status?: unknown }).status !== expectedStatus) {
        return NextResponse.json({
          error: "customer-order-status-changed",
          message: "订单状态已变化，请重试"
        }, { status: 409 });
      }
      const stored = owned.docs[0] as { mealSlot?: unknown; customerProfile?: unknown };
      const relationId = (value: unknown) => typeof value === "object" && value !== null && "id" in value
        ? (value as { id: string | number }).id : value as string | number;
      const price = await writeRelationshipsAvailable(scope.payload, transactionReq, {
        sellerId: scope.sellerId, openid: scope.openid, batchPublicId: selectedBatch,
        mealSlotId: relationId(stored.mealSlot), customerProfileId: relationId(stored.customerProfile)
      });
      if (price instanceof NextResponse) return price;
      const doc = await scope.payload.update({
        collection: "kiv1_orders", id: storedOrderId, data: { ...parsed.data, unitPriceCents: price },
        overrideAccess: true, req: transactionReq
      });
      return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) });
    });
  } catch {
    return NextResponse.json({ error: "customer-order-update-failed" }, { status: 500 });
  }
}
