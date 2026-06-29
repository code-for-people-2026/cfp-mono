import type { Where } from "payload";
import { NextResponse } from "next/server";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

type SlotInput = { date: string; occasion?: string; granularity: string };

/**
 * `POST /api/internal/service-slots/upsert` — open one slot per (date, occasion).
 * For each input: find by (seller, date, occasion); `archived` refuses auto-reopen
 * → 409 (be surfaces "needs force"); draft → flip to open; missing → create open.
 * `// ponytail:` no DB unique constraint yet (§3.2 deferred) — find-then-(create|
 * update) is fine for MVP single-operator; add the partial-unique before concurrency.
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, payload } = scope;
  const inputs = (await req.json().catch(() => null)) as SlotInput[] | null;
  if (!Array.isArray(inputs)) return NextResponse.json({ error: "slots[] required" }, { status: 400 });

  const result = [];
  for (const s of inputs) {
    const clauses: Where[] = [{ seller: { equals: sellerId } }, { date: { equals: s.date } }];
    if (s.occasion) clauses.push({ occasion: { equals: s.occasion } });
    const key = { and: clauses };
    const found = (await payload.find({ collection: "service_slots", where: key, overrideAccess: true })).docs[0] as
      | { id: string | number; status?: string }
      | undefined;
    if (found) {
      if (found.status === "archived") return NextResponse.json({ error: "slot-archived", date: s.date, occasion: s.occasion }, { status: 409 });
      if (found.status !== "open") {
        await payload.update({ collection: "service_slots", id: found.id, data: { status: "open" }, overrideAccess: true });
      }
      result.push({ ...found, status: "open" });
    } else {
      result.push(
        await payload.create({
          collection: "service_slots",
          data: { date: s.date, occasion: s.occasion, granularity: s.granularity, status: "open", seller: sellerId },
          overrideAccess: true,
        }),
      );
    }
  }
  return NextResponse.json(result);
}
