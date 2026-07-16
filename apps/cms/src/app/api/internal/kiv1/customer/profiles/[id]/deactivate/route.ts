import { customerProfileDeactivateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { customerWriteScope } from "@/lib/kiv1-internal";
import { normalizeCustomerProfile, type CustomerProfileDoc } from "../../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const scope = await customerWriteScope(req);
  if (scope instanceof NextResponse) return scope;
  const rawBody = await req.text();
  if (rawBody.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "invalid-json" }, { status: 400 });
    }
    if (!customerProfileDeactivateSchema.safeParse(body).success) {
      return NextResponse.json({ error: "invalid-customer-profile-deactivate" }, { status: 422 });
    }
  }
  const { id } = await params;
  const result = await scope.payload.find({
    collection: "kiv1_customer_profiles",
    where: { and: [
      { id: { equals: id } },
      { seller: { equals: scope.sellerId } },
      { openid: { equals: scope.openid } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  const stored = result.docs[0] as CustomerProfileDoc | undefined;
  if (!stored) return NextResponse.json({ error: "customer-profile-not-found" }, { status: 404 });
  if (!stored.active) return NextResponse.json({ doc: normalizeCustomerProfile(stored) });
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_customer_profiles",
      id,
      data: { active: false },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeCustomerProfile(doc as CustomerProfileDoc) });
  } catch {
    return NextResponse.json({ error: "customer-profile-deactivate-failed" }, { status: 500 });
  }
}
