import configPromise from "@payload-config";
import type { BasePayload } from "payload";
import { getPayload } from "payload";
import { NextResponse } from "next/server";
import { verifyToken } from "./jwt";

/** The header carrying the operator JWT on every seller-scoped internal call. */
const OPERATOR_JWT_HEADER = "x-kith-inn-operator";

/** A verified operator + the assembled Payload, ready for seller-scoped work. */
type OperatorScope = {
  sellerId: string | number;
  operatorId: string | number;
  payload: BasePayload;
};

/**
 * Verify the operator JWT and resolve the Payload instance. Returns the scope,
 * or a 401/500 NextResponse on bad token / missing secret. Every internal write
 * endpoint starts with this — `sellerId` derives from the verified JWT and is
 * stamped onto writes (overrideAccess), NEVER taken from the request body
 * (seller-token passthrough, no admin key — Tech Spec §3.1).
 */
export async function operatorScope(req: Request): Promise<OperatorScope | NextResponse> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const jwt = req.headers.get(OPERATOR_JWT_HEADER);
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const decoded = await verifyToken(jwt, jwtSecret);
  if (!decoded) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = await getPayload({ config: configPromise });
  return { sellerId: decoded.sellerId, operatorId: decoded.operatorId, payload };
}

/**
 * Does `id` in `collection` belong to `sellerId`? The internal endpoints write
 * with overrideAccess (no `req.user`), so the §3.1 `assertSameTenantRefs` hook
 * (which fires only on authenticated writes) can't guard cross-tenant refs here.
 * A seller passing another tenant's customer/offering id would otherwise get
 * stored under their sellerId and leak via depth-populated reads. Validate
 * every referenced id against the JWT's sellerId before persisting (Codex P1).
 */
export async function ownedBy(
  payload: BasePayload,
  collection: string,
  id: string | number,
  sellerId: string | number,
): Promise<boolean> {
  const res = await payload.find({
    collection,
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
  });
  return res.docs.length > 0;
}
