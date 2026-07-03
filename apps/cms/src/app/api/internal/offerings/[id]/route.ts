import { offeringUpdateSchema } from "@cfp/kith-inn-shared/schemas";
import type { BasePayload } from "payload";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * Find one offering scoped to `sellerId` (returns the doc or undefined). The
 * internal endpoints write with `overrideAccess` (no req.user), so the §3.1
 * access fn can't guard cross-tenant refs here — confirm ownership via a
 * seller-scoped find before any write (404 if absent or another tenant's).
 */
async function findOwned(payload: BasePayload, id: string, sellerId: string | number) {
  const res = await payload.find({
    collection: "offerings",
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
  });
  return res.docs[0];
}

/**
 * `PATCH /api/internal/offerings/:id` — update name/mainIngredient/category in
 * place (M1 whitelist; offeringUpdateSchema rejects empty payload). find-then-
 * update enforces seller scope (404 cross-tenant).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const parsed = offeringUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "no updatable fields" }, { status: 400 });
  if (!(await findOwned(payload, id, sellerId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const doc = await payload.update({ collection: "offerings", id, data: parsed.data, overrideAccess: true });
  return NextResponse.json({ doc });
}

/**
 * `DELETE /api/internal/offerings/:id` — soft-deactivate (active=false). The doc
 * stays (order_items/menu_plans may still reference it); it just leaves the
 * 菜品池 listing + menu candidate pool via the BE active filter. Idempotent.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  if (!(await findOwned(payload, id, sellerId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  await payload.update({ collection: "offerings", id, data: { active: false }, overrideAccess: true });
  return NextResponse.json({ ok: true });
}
