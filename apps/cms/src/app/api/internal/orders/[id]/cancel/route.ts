import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";
import { cancelOrderAtomic, OrderLifecycleError } from "@/lib/orderLifecycle";

export const dynamic = "force-dynamic";

/** Cancel one order and all of its fulfillments in one transaction. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  try {
    return NextResponse.json(await cancelOrderAtomic(scope.payload, scope.sellerId, id));
  } catch (error) {
    if (error instanceof OrderLifecycleError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
