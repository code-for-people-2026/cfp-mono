import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `POST /api/internal/offerings/:id/restore` — reactivate a soft-deactivated
 * dish (active=true). Separate route segment (Next.js App Router: `/restore` is
 * its own path, not handled by `[id]/route.ts`). find-then-update enforces
 * seller scope (404 cross-tenant). Idempotent.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  const existing = await payload.find({
    collection: "offerings",
    where: { and: [{ id: { equals: id } }, { seller: { equals: sellerId } }] },
    limit: 1,
    overrideAccess: true,
  });
  if (!existing.docs[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  await payload.update({ collection: "offerings", id, data: { active: true }, overrideAccess: true });
  return NextResponse.json({ ok: true });
}
