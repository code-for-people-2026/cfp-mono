import { NextResponse } from "next/server";
import { servicePayload } from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type MembershipDoc = {
  id: string | number;
  active?: boolean;
  seller?: unknown;
};

type SellerDoc = {
  id: string | number;
  name: string;
  status: string;
};

function validId(value: unknown): value is string | number {
  return (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isInteger(value));
}

function parseLookup(value: unknown): { openid?: string; operatorId?: string | number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) return null;
  if (keys[0] === "openid" && typeof record.openid === "string" && record.openid.trim() !== "") {
    return { openid: record.openid.trim() };
  }
  if (keys[0] === "operatorId" && validId(record.operatorId)) {
    return { operatorId: record.operatorId };
  }
  return null;
}

function sellerOf(value: unknown): SellerDoc | null {
  if (typeof value !== "object" || value === null) return null;
  const seller = value as Partial<SellerDoc>;
  return validId(seller.id) && typeof seller.name === "string" && typeof seller.status === "string"
    ? seller as SellerDoc
    : null;
}

export async function POST(req: Request) {
  const payload = await servicePayload(req);
  if (payload instanceof NextResponse) return payload;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const lookup = parseLookup(raw);
  if (!lookup) return NextResponse.json({ error: "invalid-membership-lookup" }, { status: 422 });
  const identity: Record<string, { equals: string | number }> = lookup.openid !== undefined
    ? { wechatOpenid: { equals: lookup.openid } }
    : { id: { equals: lookup.operatorId! } };
  const result = await payload.find({
    collection: "kiv1_operators",
    where: { and: [identity, { active: { equals: true } }] },
    limit: 0,
    depth: 1,
    overrideAccess: true
  });
  const memberships = (result.docs as MembershipDoc[])
    .flatMap((operator) => {
      const seller = sellerOf(operator.seller);
      return operator.active !== false && seller?.status === "active"
        ? [{ operatorId: operator.id, sellerId: seller.id, sellerName: seller.name, active: true as const }]
        : [];
    })
    .sort((a, b) => a.sellerName.localeCompare(b.sellerName, "zh-CN") || String(a.sellerId).localeCompare(String(b.sellerId)));
  return NextResponse.json({ memberships });
}
