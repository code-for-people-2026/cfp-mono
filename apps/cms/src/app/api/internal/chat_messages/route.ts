import { NextResponse } from "next/server";
import { cardPayloadSchema } from "@cfp/kith-inn-shared/schemas";
import { operatorScope } from "@/lib/internal";

export const dynamic = "force-dynamic";

/**
 * `GET /api/internal/chat_messages` — the seller's recent chat (newest first),
 * capped (default 50, max 200). Seller-scoped via the where.
 * // ponytail: no 2-day-window clip / 1000-cap GC here — runAgent trims LLM
 * context to the last ~5 turns, and the displayed-history window is a FE concern.
 * Add GC when a seller actually approaches the cap.
 */
export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, operatorId, payload } = scope;
  const parsed = Number(new URL(req.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
  const res = await payload.find({
    collection: "chat_messages",
    // Per-operator, not per-seller: each operator has their own 「今天」conversation,
    // so a second operator on the same seller must not see this one's history.
    where: { and: [{ seller: { equals: sellerId } }, { operator: { equals: operatorId } }] },
    sort: "-createdAt",
    limit,
    overrideAccess: true,
  });
  return NextResponse.json({ docs: res.docs });
}

/**
 * `POST /api/internal/chat_messages` — persist one message. `role` defaults to
 * "user" (assistant whitelisted); `seller` + `operator` are stamped from the JWT,
 * never taken from the body (seller-token passthrough, §3.1).
 */
export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { sellerId, operatorId, payload } = scope;
  const body = (await req.json().catch(() => null)) as { content?: string; role?: string; card?: unknown } | null;
  if (!body?.content) return NextResponse.json({ error: "content required" }, { status: 400 });
  const role = body.role === "assistant" ? "assistant" : "user";
  const parsedCard =
    body.card === undefined || body.card === null
      ? null
      : cardPayloadSchema.safeParse(body.card);
  if (parsedCard && !parsedCard.success) return NextResponse.json({ error: "invalid card" }, { status: 400 });
  const card = role === "assistant" && parsedCard?.success ? parsedCard.data : undefined;
  const doc = await payload.create({
    collection: "chat_messages",
    data: { content: body.content, role, operator: operatorId, seller: sellerId, ...(card ? { card } : {}) },
    overrideAccess: true,
  });
  return NextResponse.json(doc, { status: 201 });
}
