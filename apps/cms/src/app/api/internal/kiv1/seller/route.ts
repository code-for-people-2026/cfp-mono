import type { SellerSnapshot } from "@cfp/kith-inn-v1-shared";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/kiv1-internal";

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
