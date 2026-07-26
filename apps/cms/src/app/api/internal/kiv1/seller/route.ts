import type { SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import { sellerBookingSettingsUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { operatorScope, requireServiceAuth } from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type SellerDoc = SellerSnapshot;

export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const result = await scope.payload.find({
    collection: "kiv1_sellers",
    where: { id: { equals: scope.sellerId } },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  const doc = result.docs[0] as SellerDoc | undefined;
  return doc
    ? NextResponse.json({
      doc: {
        id: doc.id,
        name: doc.name,
        defaultPriceCents: doc.defaultPriceCents,
        status: doc.status
      }
    })
    : NextResponse.json({ error: "not-found" }, { status: 404 });
}

export async function PATCH(req: Request) {
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
  const parsed = sellerBookingSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-booking-settings" }, { status: 422 });
  }
  const doc = await scope.payload.update({
    collection: "kiv1_sellers",
    id: scope.sellerId,
    data: parsed.data,
    overrideAccess: true
  }) as SellerDoc;
  return NextResponse.json({ defaultPriceCents: doc.defaultPriceCents });
}
