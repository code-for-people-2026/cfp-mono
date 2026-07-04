import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/menu-plans?from=&to=` — seller's menu_plans in a date range
 * (depth:1 populates slot + offerings). Two-step (slots by date → plans by slot id)
 * because Payload can't reliably `where` on a populated rel's field (`slot.date`).
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) return NextResponse.json({ error: "from and to required" }, { status: 400 });

  const slots = await payload.find({
    collection: "service_slots",
    where: { and: [{ seller: { equals: sellerId } }, { date: { greater_than_equal: from } }, { date: { less_than_equal: to } }] },
    limit: 0,
    overrideAccess: true,
  });
  const slotIds = slots.docs.map((s) => s.id);
  if (slotIds.length === 0) return NextResponse.json({ docs: [] });
  const res = await payload.find({
    collection: "menu_plans",
    where: { and: [{ seller: { equals: sellerId } }, { slot: { in: slotIds } }] },
    depth: 1,
    limit: 0,
    overrideAccess: true,
  });
  return NextResponse.json({ docs: res.docs });
}
