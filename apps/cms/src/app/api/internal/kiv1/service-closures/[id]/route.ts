import { NextResponse } from "next/server";
import {
  findOwned,
  lockSellerDate,
  operatorScope,
  requireServiceAuth,
  withKiv1Transaction
} from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, { params }: RouteContext) {
  const serviceError = requireServiceAuth(req);
  if (serviceError) return serviceError;
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  const closure = await findOwned(scope.payload, "kiv1_service_closures", id, scope.sellerId) as
    { date?: unknown } | undefined;
  if (!closure || typeof closure.date !== "string") {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  await withKiv1Transaction(scope.payload, async (transactionReq) => {
    await lockSellerDate(scope.payload, transactionReq, scope.sellerId, closure.date as string);
    await scope.payload.delete({
      collection: "kiv1_service_closures",
      id,
      overrideAccess: true,
      req: transactionReq
    });
  });
  return new NextResponse(null, { status: 204 });
}
