import { offeringCreateSchema } from "@cfp/kith-inn-v1-shared/api";
import type { Offering } from "@cfp/kith-inn-v1-shared";
import { NextResponse } from "next/server";
import { hasSellerField, isUniqueConflict, operatorScope } from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type OfferingDoc = {
  id: string | number;
  seller: unknown;
  name: string;
  mainIngredient?: string | null;
  category: Offering["category"];
  active: boolean;
};

function relationshipId(value: unknown): string | number {
  return typeof value === "object" && value !== null && "id" in value
    ? (value as { id: string | number }).id
    : value as string | number;
}

export function normalizeOffering(doc: OfferingDoc): Offering {
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    name: doc.name,
    mainIngredient: doc.mainIngredient ?? null,
    category: doc.category,
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
  const active = new URL(req.url).searchParams.get("active") ?? "all";
  if (!(["all", "true", "false"] as const).includes(active as "all" | "true" | "false")) {
    return NextResponse.json({ error: "invalid-active-filter" }, { status: 400 });
  }
  const seller = { seller: { equals: scope.sellerId } };
  const where = active === "all"
    ? seller
    : { and: [seller, { active: { equals: active === "true" } }] };
  const result = await scope.payload.find({
    collection: "kiv1_offerings",
    where,
    sort: ["-active", "name"],
    limit: 0,
    depth: 0,
    overrideAccess: true
  });
  return NextResponse.json({ docs: (result.docs as OfferingDoc[]).map(normalizeOffering) });
}

export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const body = await requestJson(req);
  if (!body.ok) return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  const parsed = offeringCreateSchema.safeParse(body.value);
  if (hasSellerField(body.value) || !parsed.success) {
    return NextResponse.json({ error: "invalid-offering" }, { status: 422 });
  }
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_offerings",
      data: { seller: scope.sellerId, ...parsed.data, active: true },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeOffering(doc as OfferingDoc) }, { status: 201 });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "offering-name-conflict" }, { status: 409 })
      : NextResponse.json({ error: "offering-create-failed" }, { status: 500 });
  }
}
