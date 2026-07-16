import { cmsCustomerOrderCreateSchema, customerSessionBootstrapInputSchema } from "@cfp/kith-inn-v1-shared/api";
import { relationshipIdSchema } from "@cfp/kith-inn-v1-shared/schemas";
import type { BasePayload, PayloadRequest } from "payload";
import { NextResponse } from "next/server";
import { customerWriteScope, isUniqueConflict, lockCustomerAvailability, withCustomerOrderLock }
  from "@/lib/kiv1-internal";
import { normalizeOrder } from "../../orders/route";

export const dynamic = "force-dynamic";

export function relationshipId(value: string): string | number | null {
  const parsed = relationshipIdSchema.safeParse(/^\d+$/.test(value) ? Number(value) : value);
  return parsed.success ? parsed.data : null;
}

export function batchPublicId(req: Request): string | null {
  const parsed = customerSessionBootstrapInputSchema.safeParse({ batchPublicId:
    new URL(req.url).searchParams.get("batchPublicId") });
  return parsed.success ? parsed.data.batchPublicId : null;
}

const relationId = (value: unknown) => typeof value === "object" && value !== null && "id" in value
  ? (value as { id: string | number }).id : value;
export const databaseId = (value: unknown): number | null => { const id = typeof value === "number" ? value
  : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN; return Number.isSafeInteger(id) && id > 0 ? id : null; };
export async function writeRelationshipsAvailable(payload: BasePayload, transactionReq: PayloadRequest, input: {
  sellerId: string | number; openid: string; batchPublicId: string; mealSlotId: string | number; customerProfileId: string | number;
}): Promise<NextResponse | number> {
  const sellerId = databaseId(input.sellerId), mealSlotId = databaseId(input.mealSlotId),
    customerProfileId = databaseId(input.customerProfileId);
  if (!sellerId || !mealSlotId || !customerProfileId) return NextResponse.json({ error: "relationship-owner-mismatch" }, { status: 409 });
  await lockCustomerAvailability(payload, transactionReq, { sellerId, mealSlotId, batchPublicId: input.batchPublicId });
  const common = { limit: 1, depth: 0, overrideAccess: true, req: transactionReq } as const;
  const [batches, slots, profiles, sellers] = await Promise.all([
    payload.find({ collection: "kiv1_booking_batches", where: { and: [{ publicId: { equals: input.batchPublicId } },
      { seller: { equals: sellerId } }] }, ...common }),
    payload.find({ collection: "kiv1_meal_slots", where: { and: [{ id: { equals: mealSlotId } },
      { seller: { equals: sellerId } }] }, ...common }),
    payload.find({ collection: "kiv1_customer_profiles", where: { and: [{ id: { equals: customerProfileId } },
      { seller: { equals: sellerId } }, { openid: { equals: input.openid } }, { active: { equals: true } }] }, ...common }),
    payload.find({ collection: "kiv1_sellers", where: { id: { equals: sellerId } }, ...common })
  ]);
  const batch = batches.docs[0] as { status?: unknown; mealSlots?: unknown } | undefined;
  const slot = slots.docs[0] as { orderStatus?: unknown; orderDeadline?: unknown; priceCents?: unknown } | undefined;
  const seller = sellers.docs[0] as { defaultPriceCents?: unknown } | undefined;
  if (!batch || !slot || !seller || profiles.docs.length === 0) {
    return NextResponse.json({ error: "relationship-owner-mismatch" }, { status: 409 });
  }
  if (!Array.isArray(batch.mealSlots) || !batch.mealSlots.some((id) => String(relationId(id)) === String(mealSlotId))) {
    return NextResponse.json({ error: "meal-slot-not-in-batch", message: "餐次不属于当前预订批次" }, { status: 409 });
  }
  if (batch.status !== "open") return NextResponse.json({ error: "booking-batch-closed", message: "预订批次已关闭" }, { status: 409 });
  if (slot.orderStatus !== "open") return NextResponse.json({ error: "meal-slot-closed", message: "餐次已关闭登记" }, { status: 409 });
  if (typeof slot.orderDeadline !== "string" || Date.parse(slot.orderDeadline) <= Date.now()) {
    return NextResponse.json({ error: "order-deadline-passed", message: "餐次登记已截止" }, { status: 409 });
  }
  const price = slot.priceCents ?? seller.defaultPriceCents;
  return typeof price === "number" && Number.isSafeInteger(price) && price >= 0 ? price : NextResponse.json({ error: "invalid-order-price" }, { status: 500 });
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
  const selectedBatch = batchPublicId(req);
  if (!selectedBatch) return NextResponse.json({ error: "invalid-batch-public-id" }, { status: 400 });
  const { mealSlotId, customerProfileId, ...data } = parsed.data;
  if (data.customerOpenid !== scope.openid) {
    return NextResponse.json({ error: "relationship-owner-mismatch" }, { status: 409 });
  }
  try {
    return await withCustomerOrderLock(scope.payload, null, async (transactionReq) => {
      const price = await writeRelationshipsAvailable(scope.payload, transactionReq, {
        sellerId: scope.sellerId, openid: scope.openid, batchPublicId: selectedBatch, mealSlotId, customerProfileId
      });
      if (price instanceof NextResponse) return price;
      const doc = await scope.payload.create({
        collection: "kiv1_orders",
        data: { seller: scope.sellerId, mealSlot: mealSlotId, customerProfile: customerProfileId, ...data,
          unitPriceCents: price },
        overrideAccess: true, req: transactionReq
      });
      return NextResponse.json({ doc: normalizeOrder(doc as Parameters<typeof normalizeOrder>[0]) }, { status: 201 });
    });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "order-exists" }, { status: 409 })
      : NextResponse.json({ error: "customer-order-create-failed" }, { status: 500 });
  }
}
