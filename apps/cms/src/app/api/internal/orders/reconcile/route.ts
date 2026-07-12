import { orderReconciliationRequestSchema } from "@cfp/kith-inn-shared/schemas";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";
import { OrderLifecycleError, reconcileOrdersAtomic } from "@/lib/orderLifecycle";

export const dynamic = "force-dynamic";

/** Atomically replace every active order in the confirmed date/meal snapshot scope. */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const parsed = orderReconciliationRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid-reconciliation" }, { status: 400 });
  try {
    return NextResponse.json(await reconcileOrdersAtomic(scope.payload, scope.sellerId, scope.operatorId, parsed.data));
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
