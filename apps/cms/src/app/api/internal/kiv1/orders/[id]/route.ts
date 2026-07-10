import { cmsOrderUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { findOwned, hasSellerField, operatorScope, requireServiceAuth } from "@/lib/kiv1-internal";
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
  if (!await findOwned(scope.payload, "kiv1_orders", id, scope.sellerId)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_orders",
      id,
      data: parsed.data,
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) });
  } catch {
    return NextResponse.json({ error: "order-update-failed" }, { status: 500 });
  }
}
