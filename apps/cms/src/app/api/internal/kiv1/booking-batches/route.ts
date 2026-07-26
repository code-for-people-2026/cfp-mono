import {
  bookingShareTargetSchema,
  bookingBatchListQuerySchema,
  cmsBookingBatchCreateSchema,
  cmsBookingBatchTargetedCreateSchema
} from "@cfp/kith-inn-v1-shared/api";
import type { BookingBatch, BookingShareTarget } from "@cfp/kith-inn-v1-shared";
import type { Where } from "payload";
import { NextResponse } from "next/server";
import {
  findOwned,
  hasSellerField,
  isUniqueConflict,
  operatorScope,
  requireServiceAuth
} from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type BookingBatchDoc = {
  id: string | number;
  seller: unknown;
  publicId: string;
  title: string;
  status: BookingBatch["status"];
  mealSlots: unknown[];
  createdBy: unknown;
  target?: unknown;
};

const relationshipId = (value: unknown): string | number =>
  typeof value === "object" && value !== null && "id" in value
    ? (value as { id: string | number }).id
    : value as string | number;

export function normalizeBookingBatch(doc: BookingBatchDoc): BookingBatch {
  const rawTarget = typeof doc.target === "object" && doc.target !== null &&
    (doc.target as { kind?: unknown }).kind === "day"
    ? { kind: "day", date: (doc.target as { date?: unknown }).date }
    : doc.target;
  const target = bookingShareTargetSchema.safeParse(rawTarget);
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    publicId: doc.publicId,
    title: doc.title,
    status: doc.status,
    mealSlotIds: doc.mealSlots.map(relationshipId),
    createdById: relationshipId(doc.createdBy),
    target: target.success ? target.data : null
  };
}

type TargetSlot = { id: string | number; date?: unknown; occasion?: unknown; orderStatus?: unknown };

async function ownedSlots(
  payload: Parameters<typeof findOwned>[0],
  collection: string,
  ids: Array<string | number>,
  sellerId: string | number
): Promise<TargetSlot[] | null> {
  const docs: TargetSlot[] = [];
  for (const id of ids) {
    const doc = await findOwned(payload, collection, id, sellerId);
    if (!doc) return null;
    docs.push(doc as TargetSlot);
  }
  return docs;
}

function targetMatchesSlots(target: BookingShareTarget, slots: TargetSlot[]): boolean {
  if (slots.some(({ date, orderStatus }) => date !== target.date || orderStatus !== "open")) return false;
  return target.kind === "day" || (slots.length === 1 && slots[0]?.occasion === target.occasion);
}

export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const value = new URL(req.url).searchParams.get("status") ?? undefined;
  const parsed = bookingBatchListQuerySchema.safeParse({ status: value });
  if (!parsed.success) return NextResponse.json({ error: "invalid-booking-batch-status" }, { status: 400 });
  const filters: Where[] = [{ seller: { equals: scope.sellerId } }];
  if (parsed.data.status) filters.push({ status: { equals: parsed.data.status } });
  const result = await scope.payload.find({
    collection: "kiv1_booking_batches",
    where: { and: filters },
    sort: "-createdAt",
    limit: 0,
    depth: 0,
    overrideAccess: true
  });
  return NextResponse.json({ docs: (result.docs as BookingBatchDoc[]).map(normalizeBookingBatch) });
}

export async function POST(req: Request) {
  const serviceError = requireServiceAuth(req);
  if (serviceError) return serviceError;
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const targeted = cmsBookingBatchTargetedCreateSchema.safeParse(body);
  const legacy = cmsBookingBatchCreateSchema.safeParse(body);
  const input = targeted.success ? targeted.data : legacy.success ? legacy.data : null;
  if (hasSellerField(body) || input === null) {
    return NextResponse.json({ error: "invalid-booking-batch" }, { status: 422 });
  }
  const slots = await ownedSlots(scope.payload, "kiv1_meal_slots", input.mealSlotIds, scope.sellerId);
  if (String(input.createdById) !== String(scope.operatorId) || !slots ||
    (targeted.success && !targetMatchesSlots(targeted.data.target, slots))) {
    return NextResponse.json({ error: "invalid-booking-batch-relationship" }, { status: 422 });
  }
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_booking_batches",
      data: {
        seller: scope.sellerId,
        publicId: input.publicId,
        title: input.title,
        status: input.status,
        mealSlots: input.mealSlotIds,
        createdBy: input.createdById,
        ...(targeted.success ? { target: targeted.data.target } : {})
      },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeBookingBatch(doc as BookingBatchDoc) }, { status: 201 });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "booking-batch-conflict" }, { status: 409 })
      : NextResponse.json({ error: "booking-batch-create-failed" }, { status: 500 });
  }
}
