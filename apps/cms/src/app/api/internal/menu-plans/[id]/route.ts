import { NextResponse } from "next/server";
import { operatorScope, ownedBy } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/menu-plans/:id` — single plan (depth:1), seller-scoped (404
 * cross-tenant). be's publish-text uses it to load one plan + check publishText cache.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const res = await payload.find({
    collection: "menu_plans",
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    depth: 1,
    limit: 1,
    overrideAccess: true,
  });
  if (!res.docs[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ doc: res.docs[0] });
}

/**
 * `PATCH /api/internal/menu-plans/:id` — update {status?, publishText?, offerings?}
 * (whitelist). find-then-update (cross-tenant 404). offerings each `ownedBy`-checked
 * (overrideAccess write has no req.user → assertSameTenantRefs can't fire, Codex #115 P1).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string; publishText?: string | null; offerings?: Array<string | number> };
  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.publishText !== undefined) data.publishText = body.publishText; // null clears
  if (body.offerings !== undefined) {
    for (const oid of body.offerings) {
      if (!(await ownedBy(payload, "offerings", oid, sellerId))) {
        return NextResponse.json({ error: "offering not owned" }, { status: 403 });
      }
    }
    data.offerings = body.offerings;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "no updatable fields" }, { status: 400 });
  const existing = await payload.find({
    collection: "menu_plans",
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
  });
  if (!existing.docs[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  const doc = await payload.update({ collection: "menu_plans", id, data, overrideAccess: true });
  return NextResponse.json({ doc });
}
