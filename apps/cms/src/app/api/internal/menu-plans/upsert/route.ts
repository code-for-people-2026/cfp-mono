import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope, ownedBy } from "@/lib/internal";
import { normalizeServiceSlotDate } from "@/lib/serviceSlotDate";

export const dynamic = "force-dynamic";

type PlanInput = { date: string; occasion?: string; offerings: Array<string | number>; status: string };

/**
 * `POST /api/internal/menu-plans/upsert` — generate's writer. For each input:
 *  1. validate every offering id in the full batch belongs to the seller (ownedBy, else 403).
 *  2. ensure service_slot exists for (seller, date, occasion) — keep existing status
 *     (do NOT open; slot opening stays order-confirm's job); create as draft if missing.
 *  3. upsert menu_plan by (seller, slot) — update offerings/status or create.
 * The (seller, slot) unique index (ensureConstraints) backs the one-plan-per-slot invariant.
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const inputs = (await req.json().catch(() => null)) as PlanInput[] | null;
  if (!Array.isArray(inputs)) return NextResponse.json({ error: "plans[] required" }, { status: 400 });

  for (const p of inputs) {
    for (const oid of p.offerings) {
      if (!(await ownedBy(payload, "offerings", oid, sellerId))) {
        return NextResponse.json({ error: "offering not owned" }, { status: 403 });
      }
    }
  }

  const docs = [];
  for (const p of inputs) {
    // Payload normalizes date query operands to ISO timestamps. Persist the same
    // representation so SQLite's text comparison matches Postgres semantics.
    const slotDate = normalizeServiceSlotDate(p.date);
    const clauses: Where[] = [{ seller: { equals: sellerId } }, { date: { equals: slotDate } }];
    if (p.occasion) clauses.push({ occasion: { equals: p.occasion } });
    const slotRes = await payload.find({ collection: "service_slots", where: { and: clauses }, limit: 1, overrideAccess: true });
    let slotId = (slotRes.docs[0] as { id: string | number } | undefined)?.id;
    if (!slotId) {
      const created = await payload.create({
        collection: "service_slots",
        data: { date: slotDate, occasion: p.occasion, granularity: "occasion", status: "draft", seller: sellerId },
        overrideAccess: true,
      });
      slotId = created.id;
    }

    const planRes = await payload.find({
      collection: "menu_plans",
      where: { and: [{ slot: { equals: slotId } }, { seller: { equals: sellerId } }] },
      limit: 1,
      overrideAccess: true,
    });
    const existing = planRes.docs[0] as { id: string | number } | undefined;
    if (existing) {
      docs.push(
        await payload.update({
          collection: "menu_plans",
          id: existing.id,
          // regenerate = new dishes → old publishText is stale; clear it so /publish rebuilds
          // (Codex #116 P1).
          data: { offerings: p.offerings, status: p.status, publishText: null },
          overrideAccess: true,
        }),
      );
    } else {
      docs.push(
        await payload.create({
          collection: "menu_plans",
          data: { slot: slotId, offerings: p.offerings, status: p.status, seller: sellerId },
          overrideAccess: true,
        }),
      );
    }
  }
  return NextResponse.json({ docs });
}
