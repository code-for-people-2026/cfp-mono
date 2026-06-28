import configPromise from "@payload-config";
import { getPayload } from "payload";
import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/offerings` — seller-scoped offerings read for the BE.
 * Verifies the operator JWT (`x-kith-inn-operator`, shared JWT_SECRET), extracts
 * sellerId, and reads with `overrideAccess` scoped to that sellerId. This is
 * seller-token passthrough (the JWT carries the seller) — NOT a万能 admin key.
 * The manual WHERE seller scoping is the M0 internal-call pattern (§3.1's
 * access-fn trust is the hardening target).
 */
export async function GET(req: Request) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const operatorJwt = req.headers.get("x-kith-inn-operator");
  if (!operatorJwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const decoded = await verifyToken(operatorJwt, jwtSecret);
  if (!decoded) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const payload = await getPayload({ config: configPromise });
  const res = await payload.find({
    collection: "offerings",
    where: { seller: { equals: decoded.sellerId } },
    overrideAccess: true,
    limit: 0, // disable default pagination (limit=10) — return the full pool
  });
  return NextResponse.json({ docs: res.docs });
}
