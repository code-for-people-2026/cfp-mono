import { customerProfileCreateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { customerScope, customerWriteScope } from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

export type CustomerProfileDoc = {
  id: string | number;
  seller: unknown;
  openid?: string | null;
  displayName: string;
  address: string;
  active: boolean;
};

function relationshipId(value: unknown): string | number {
  return typeof value === "object" && value !== null && "id" in value
    ? (value as { id: string | number }).id
    : value as string | number;
}

export function normalizeCustomerProfile(doc: CustomerProfileDoc) {
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    displayName: doc.displayName,
    address: doc.address,
    active: doc.active
  };
}

async function requestJson(req: Request): Promise<unknown | undefined> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  const scope = await customerScope(req);
  if (scope instanceof NextResponse) return scope;
  const result = await scope.payload.find({
    collection: "kiv1_customer_profiles",
    where: { and: [
      { seller: { equals: scope.sellerId } },
      { openid: { equals: scope.openid } },
      { active: { equals: true } }
    ] },
    sort: "-lastUsedAt",
    limit: 0,
    depth: 0,
    overrideAccess: true
  });
  return NextResponse.json({ docs: (result.docs as CustomerProfileDoc[]).map(normalizeCustomerProfile) });
}

export async function POST(req: Request) {
  const scope = await customerWriteScope(req);
  if (scope instanceof NextResponse) return scope;
  const body = await requestJson(req);
  if (body === undefined) return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  const parsed = customerProfileCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid-customer-profile" }, { status: 422 });
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_customer_profiles",
      data: {
        seller: scope.sellerId,
        openid: scope.openid,
        ...parsed.data,
        active: true,
        lastUsedAt: new Date().toISOString()
      },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeCustomerProfile(doc as CustomerProfileDoc) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "customer-profile-create-failed" }, { status: 500 });
  }
}
