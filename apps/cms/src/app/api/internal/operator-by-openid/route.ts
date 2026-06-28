import configPromise from "@payload-config";
import { getPayload } from "payload";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * `POST /api/internal/operator-by-openid { openid }` — login-flow operator
 * lookup. The BE calls this during wx-login / dev-login (before the operator has
 * a session, so it can't ride tenant-scoped access). Protected by
 * `x-internal-token` (BE↔cms service auth, NOT a tenant admin key). Returns the
 * operator's normalized fields or 404.
 */
export async function POST(req: Request) {
  const internalToken = process.env.CMS_INTERNAL_TOKEN;
  if (!internalToken || req.headers.get("x-internal-token") !== internalToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { openid } = (await req.json().catch(() => ({}))) as { openid?: unknown };
  if (typeof openid !== "string" || openid === "") {
    return NextResponse.json({ error: "openid required" }, { status: 400 });
  }
  const payload = await getPayload({ config: configPromise });
  const res = await payload.find({
    collection: "operators",
    where: { wechatOpenid: { equals: openid } },
    limit: 1,
    overrideAccess: true,
  });
  const doc = res.docs[0] as { id: string | number; role: string; active: boolean; seller: unknown } | undefined;
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sellerId =
    typeof doc.seller === "object" && doc.seller !== null && "id" in doc.seller
      ? (doc.seller as { id: string | number }).id
      : (doc.seller as string | number);
  return NextResponse.json({ id: doc.id, sellerId, role: doc.role, active: doc.active });
}
