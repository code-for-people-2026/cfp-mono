import { cmsOrderUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { findOwned, hasSellerField, jielongMarkerFromNote, operatorScope, requireServiceAuth, withCustomerOrderLock }
  from "@/lib/kiv1-internal";
import { normalizeOrder } from "../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  const doc = await findOwned(scope.payload, "kiv1_orders", id, scope.sellerId);
  return doc
    ? NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) })
    : NextResponse.json({ error: "not-found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const serviceAuthError = requireServiceAuth(req);
  if (serviceAuthError) return serviceAuthError;
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = cmsOrderUpdateSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-order-update" }, { status: 422 });
  }
  const { id } = await params;
  const storedOrderId = /^\d+$/.test(id) ? Number(id) : NaN;
  if (!Number.isSafeInteger(storedOrderId) || storedOrderId <= 0) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  try {
    return await withCustomerOrderLock(scope.payload, storedOrderId, async (transactionReq) => {
      const result = await scope.payload.find({
        collection: "kiv1_orders",
        where: { and: [{ id: { equals: storedOrderId } }, { seller: { equals: scope.sellerId } }] },
        limit: 1, depth: 0, overrideAccess: true, req: transactionReq
      });
      const stored = result.docs[0] as { status?: unknown; source?: unknown; note?: string | null } | undefined;
      if (!stored) return NextResponse.json({ error: "not-found" }, { status: 404 });
      if (stored.source === "jielong-import" && parsed.data.address !== undefined) {
        return NextResponse.json({ error: "invalid-order-update" }, { status: 422 });
      }
      let update = parsed.data;
      if (stored.source === "jielong-import" && parsed.data.note !== undefined) {
        const marker = jielongMarkerFromNote(stored.note);
        if (!marker) return NextResponse.json({ error: "invalid-jielong-marker" }, { status: 409 });
        if ((parsed.data.note?.length ?? 0) > 914) {
          return NextResponse.json({ error: "invalid-order-update" }, { status: 422 });
        }
        update = { ...parsed.data, note: `${marker}${parsed.data.note ?? ""}` };
      }
      const expectedStatus = parsed.data.status === "confirmed" ? "draft"
        : parsed.data.status === "draft" ? "canceled" : undefined;
      if ((expectedStatus !== undefined && stored.status !== expectedStatus)
        || (parsed.data.status === "canceled" && stored.status === "canceled")
        || (parsed.data.status === undefined && stored.status === "canceled")) {
        return NextResponse.json({ error: "order-status-changed", message: "订单状态已变化，请重试" }, { status: 409 });
      }
      const doc = await scope.payload.update({
        collection: "kiv1_orders", id: storedOrderId, data: update, overrideAccess: true, req: transactionReq
      });
      return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) });
    });
  } catch {
    return NextResponse.json({ error: "order-update-failed" }, { status: 500 });
  }
}
