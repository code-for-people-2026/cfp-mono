import { bookingBatchUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import {
  findOwned,
  hasSellerField,
  operatorScope,
  requireServiceAuth
} from "@/lib/kiv1-internal";
import { normalizeBookingBatch } from "../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext) {
  const serviceError = requireServiceAuth(req);
  if (serviceError) return serviceError;
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = bookingBatchUpdateSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-booking-batch-update" }, { status: 422 });
  }
  const { id } = await params;
  const existing = await findOwned(scope.payload, "kiv1_booking_batches", id, scope.sellerId);
  if (!existing) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if ((existing as { status?: unknown }).status === "closed") {
    return NextResponse.json({
      doc: normalizeBookingBatch(existing as Parameters<typeof normalizeBookingBatch>[0])
    });
  }
  if ((existing as { status?: unknown }).status === "archived") {
    return NextResponse.json({ error: "invalid-booking-batch-transition" }, { status: 409 });
  }
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_booking_batches",
      id,
      data: parsed.data,
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeBookingBatch(doc as Parameters<typeof normalizeBookingBatch>[0]) });
  } catch {
    return NextResponse.json({ error: "booking-batch-update-failed" }, { status: 500 });
  }
}
