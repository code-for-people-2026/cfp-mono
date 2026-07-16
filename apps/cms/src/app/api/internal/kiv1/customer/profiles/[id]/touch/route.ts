import { NextResponse } from "next/server";
import { customerWriteScope } from "@/lib/kiv1-internal";
import { normalizeCustomerProfile, type CustomerProfileDoc } from "../../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const scope = await customerWriteScope(req);
  if (scope instanceof NextResponse) return scope;
  if ((await req.text()).trim() !== "") {
    return NextResponse.json({ error: "invalid-customer-profile-touch" }, { status: 422 });
  }
  const { id } = await params;
  const result = await scope.payload.find({
    collection: "kiv1_customer_profiles",
    where: { and: [
      { id: { equals: id } },
      { seller: { equals: scope.sellerId } },
      { openid: { equals: scope.openid } },
      { active: { equals: true } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  if (!result.docs[0]) return NextResponse.json({ error: "customer-profile-not-found" }, { status: 404 });
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_customer_profiles",
      id,
      data: { lastUsedAt: new Date().toISOString() },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeCustomerProfile(doc as CustomerProfileDoc) });
  } catch {
    return NextResponse.json({ error: "customer-profile-touch-failed" }, { status: 500 });
  }
}
