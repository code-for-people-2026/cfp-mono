import { customerProfileCreateSchema } from "@cfp/kith-inn-v1-shared/api";
import type { CmsCustomerProfile } from "@cfp/kith-inn-v1-shared";
import { NextResponse } from "next/server";
import type { Where } from "payload";
import { hasSellerField, operatorScope } from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type CustomerProfileDoc = {
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

export function normalizeCustomerProfile(doc: CustomerProfileDoc): CmsCustomerProfile {
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    openid: doc.openid ?? null,
    displayName: doc.displayName,
    address: doc.address,
    active: doc.active
  };
}

async function requestJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false };
  }
}

export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const query = new URL(req.url).searchParams.get("query") ?? "";
  if (query.length > 240) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  const filters: Where[] = [
    { seller: { equals: scope.sellerId } },
    { active: { equals: true } }
  ];
  if (query) filters.push({ or: [{ displayName: { contains: query } }, { address: { contains: query } }] });
  const result = await scope.payload.find({
    collection: "kiv1_customer_profiles",
    where: { and: filters },
    sort: ["displayName", "address"],
    limit: 0,
    depth: 0,
    overrideAccess: true
  });
  return NextResponse.json({ docs: (result.docs as CustomerProfileDoc[]).map(normalizeCustomerProfile) });
}

export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const body = await requestJson(req);
  if (!body.ok) return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  const parsed = customerProfileCreateSchema.safeParse(body.value);
  if (hasSellerField(body.value) || !parsed.success) {
    return NextResponse.json({ error: "invalid-customer-profile" }, { status: 422 });
  }
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_customer_profiles",
      data: {
        seller: scope.sellerId,
        ...parsed.data,
        openid: null,
        active: true
      },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeCustomerProfile(doc as CustomerProfileDoc) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "customer-profile-create-failed" }, { status: 500 });
  }
}
