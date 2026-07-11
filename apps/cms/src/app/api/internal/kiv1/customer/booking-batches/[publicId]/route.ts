import { NextResponse } from "next/server";
import { customerScope, findOwned } from "@/lib/kiv1-internal";
import { normalizeBookingBatch } from "../../../booking-batches/route";
import { normalizeMealSlot } from "../../../meal-slots/route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ publicId: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const scope = await customerScope(req);
  if (scope instanceof NextResponse) return scope;
  const { publicId } = await params;
  const batches = await scope.payload.find({
    collection: "kiv1_booking_batches",
    where: { and: [
      { publicId: { equals: publicId } },
      { seller: { equals: scope.sellerId } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  const batch = batches.docs[0];
  if (!batch) return NextResponse.json({ error: "booking-batch-not-found" }, { status: 404 });
  const sellers = await scope.payload.find({
    collection: "kiv1_sellers",
    where: { id: { equals: scope.sellerId } },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  const seller = sellers.docs[0];
  if (!seller) return NextResponse.json({ error: "seller-inactive" }, { status: 403 });
  const normalizedBatch = normalizeBookingBatch(batch as Parameters<typeof normalizeBookingBatch>[0]);
  const slots = [];
  for (const id of normalizedBatch.mealSlotIds) {
    const slot = await findOwned(scope.payload, "kiv1_meal_slots", id, scope.sellerId);
    if (!slot) return NextResponse.json({ error: "relationship-owner-mismatch" }, { status: 409 });
    slots.push(normalizeMealSlot(slot as Parameters<typeof normalizeMealSlot>[0]));
  }
  return NextResponse.json({
    seller: {
      id: seller.id,
      name: seller.name,
      defaultPriceCents: seller.defaultPriceCents,
      status: seller.status
    },
    batch: normalizedBatch,
    slots
  });
}
