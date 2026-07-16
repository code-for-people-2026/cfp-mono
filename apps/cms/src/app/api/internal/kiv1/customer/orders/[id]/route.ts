import { cmsCustomerOrderUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { customerWriteScope, withCustomerOrderLock } from "@/lib/kiv1-internal";
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
  const expectedStatus = new URL(req.url).searchParams.get("expectedStatus");
  if (expectedStatus !== "draft" && expectedStatus !== "canceled") {
    return NextResponse.json({ error: "invalid-expected-order-status" }, { status: 400 });
  }
  const { id } = await params;
  try {
    return await withCustomerOrderLock(scope.payload, id, async (transactionReq) => {
      const owned = await scope.payload.find({
        collection: "kiv1_orders",
        where: { and: [
          { id: { equals: id } }, { seller: { equals: scope.sellerId } },
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
      const doc = await scope.payload.update({
        collection: "kiv1_orders", id, data: parsed.data, overrideAccess: true, req: transactionReq
      });
      return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) });
    });
  } catch {
    return NextResponse.json({ error: "customer-order-update-failed" }, { status: 500 });
  }
}
