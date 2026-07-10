import { verifyOperatorToken } from "@cfp/kith-inn-v1-shared/auth";
import configPromise from "@payload-config";
import { getPayload, type BasePayload } from "payload";
import { NextResponse } from "next/server";

const KIV1_INTERNAL_HEADER = "x-kith-inn-v1-internal";
const KIV1_OPERATOR_HEADER = "x-kith-inn-v1-operator";

type Kiv1OperatorScope = {
  operatorId: string | number;
  sellerId: string | number;
  token: string;
  payload: BasePayload;
};

export async function servicePayload(req: Request): Promise<BasePayload | NextResponse> {
  const expected = process.env.KITH_INN_V1_INTERNAL_TOKEN;
  if (!expected) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  if (req.headers.get(KIV1_INTERNAL_HEADER) !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return getPayload({ config: configPromise });
}

export async function operatorScope(req: Request): Promise<Kiv1OperatorScope | NextResponse> {
  const secret = process.env.KITH_INN_V1_JWT_SECRET;
  if (!secret) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const token = req.headers.get(KIV1_OPERATOR_HEADER);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claims = await verifyOperatorToken(token, secret);
  if (!claims) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await getPayload({ config: configPromise });
  const memberships = await payload.find({
    collection: "kiv1_operators",
    where: { and: [
      { id: { equals: claims.operatorId } },
      { seller: { equals: claims.sellerId } },
      { active: { equals: true } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  if (memberships.docs.length === 0) {
    return NextResponse.json({ error: "membership-inactive" }, { status: 403 });
  }
  const sellers = await payload.find({
    collection: "kiv1_sellers",
    where: { and: [
      { id: { equals: claims.sellerId } },
      { status: { equals: "active" } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  if (sellers.docs.length === 0) {
    return NextResponse.json({ error: "seller-inactive" }, { status: 403 });
  }
  return {
    operatorId: claims.operatorId,
    sellerId: claims.sellerId,
    token,
    payload
  };
}

export function hasSellerField(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "seller");
}

export async function findOwned(
  payload: Pick<BasePayload, "find">,
  collection: string,
  id: string | number,
  sellerId: string | number
): Promise<unknown | undefined> {
  const result = await payload.find({
    collection,
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true
  });
  return result.docs[0];
}

export function isUniqueConflict(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return status === 409 || /unique|duplicate|already exists|constraint/i.test(message);
}
