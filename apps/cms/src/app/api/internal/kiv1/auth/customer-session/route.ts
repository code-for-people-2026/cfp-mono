import { customerSessionBootstrapInputSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { servicePayload } from "@/lib/kiv1-internal";
import { normalizeBookingBatch } from "../../booking-batches/route";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const payload = await servicePayload(req);
  if (payload instanceof NextResponse) return payload;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = customerSessionBootstrapInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid-customer-session-request" }, { status: 422 });
  const batches = await payload.find({
    collection: "kiv1_booking_batches",
    where: { publicId: { equals: parsed.data.batchPublicId } },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  const batch = batches.docs[0];
  if (!batch) return NextResponse.json({ error: "booking-batch-not-found" }, { status: 404 });
  const sellerId = typeof batch.seller === "object" && batch.seller !== null ? batch.seller.id : batch.seller;
  const sellers = await payload.find({
    collection: "kiv1_sellers",
    where: { id: { equals: sellerId } },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  const seller = sellers.docs[0];
  if (!seller || seller.status !== "active") {
    return NextResponse.json({ error: "seller-inactive" }, { status: 403 });
  }
  return NextResponse.json({
    seller: {
      id: seller.id,
      name: seller.name,
      defaultPriceCents: seller.defaultPriceCents,
      status: seller.status
    },
    batch: normalizeBookingBatch(batch as Parameters<typeof normalizeBookingBatch>[0])
  });
}
