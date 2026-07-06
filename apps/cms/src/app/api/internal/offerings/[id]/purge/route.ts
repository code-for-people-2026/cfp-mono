import { NextResponse } from "next/server";
import { operatorScope, ownedBy } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `DELETE /api/internal/offerings/:id/purge` — hard delete (彻底删除). FK-guarded
 * by DB: if order_items/menu_plans reference it, postgres FK throws → 500.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const { id } = await params;
  if (!(await ownedBy(payload, "offerings", id, sellerId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  await payload.delete({ collection: "offerings", id });
  return NextResponse.json({ ok: true });
}
