import { cmsCustomerOrderCreateSchema } from "@cfp/kith-inn-v1-shared/api";
import { relationshipIdSchema } from "@cfp/kith-inn-v1-shared/schemas";
import type { BasePayload } from "payload";
import { NextResponse } from "next/server";
import { customerWriteScope, isUniqueConflict } from "@/lib/kiv1-internal";
import { normalizeOrder } from "../../orders/route";

export const dynamic = "force-dynamic";

export function relationshipId(value: string): string | number | null {
  const parsed = relationshipIdSchema.safeParse(/^\d+$/.test(value) ? Number(value) : value);
  return parsed.success ? parsed.data : null;
}

export async function relationshipsOwned(
  payload: Pick<BasePayload, "find">,
  sellerId: string | number,
  openid: string,
  mealSlotId: string | number,
  customerProfileId: string | number
) {
  const [slot, profile] = await Promise.all([
    payload.find({
      collection: "kiv1_meal_slots",
      where: { and: [{ id: { equals: mealSlotId } }, { seller: { equals: sellerId } }] },
      limit: 1, depth: 0, overrideAccess: true
    }),
    payload.find({
      collection: "kiv1_customer_profiles",
      where: { and: [
        { id: { equals: customerProfileId } }, { seller: { equals: sellerId } },
        { openid: { equals: openid } }, { active: { equals: true } }
      ] },
      limit: 1, depth: 0, overrideAccess: true
    })
  ]);
  return slot.docs.length > 0 && profile.docs.length > 0;
}

export async function POST(req: Request) {
  const scope = await customerWriteScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = cmsCustomerOrderCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid-customer-order" }, { status: 422 });
  const { mealSlotId, customerProfileId, ...data } = parsed.data;
  if (data.customerOpenid !== scope.openid || !await relationshipsOwned(
    scope.payload, scope.sellerId, scope.openid, mealSlotId, customerProfileId
  )) {
    return NextResponse.json({ error: "relationship-owner-mismatch" }, { status: 409 });
  }
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_orders",
      data: { seller: scope.sellerId, mealSlot: mealSlotId, customerProfile: customerProfileId, ...data },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) }, { status: 201 });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "order-exists" }, { status: 409 })
      : NextResponse.json({ error: "customer-order-create-failed" }, { status: 500 });
  }
}
