import {
  bookingBatchListQuerySchema,
  cmsBookingBatchCreateSchema
} from "@cfp/kith-inn-v1-shared/api";
import type { BookingBatch } from "@cfp/kith-inn-v1-shared";
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
};

const relationshipId = (value: unknown): string | number =>
  typeof value === "object" && value !== null && "id" in value
    ? (value as { id: string | number }).id
    : value as string | number;

export function normalizeBookingBatch(doc: BookingBatchDoc): BookingBatch {
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    publicId: doc.publicId,
    title: doc.title,
    status: doc.status,
    mealSlotIds: doc.mealSlots.map(relationshipId),
    createdById: relationshipId(doc.createdBy)
  };
}

async function ownsAll(
  payload: Parameters<typeof findOwned>[0],
  collection: string,
  ids: Array<string | number>,
  sellerId: string | number
) {
  for (const id of ids) if (!await findOwned(payload, collection, id, sellerId)) return false;
  return true;
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
  const parsed = cmsBookingBatchCreateSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-booking-batch" }, { status: 422 });
  }
  const input = parsed.data;
  if (String(input.createdById) !== String(scope.operatorId) ||
    !await ownsAll(scope.payload, "kiv1_meal_slots", input.mealSlotIds, scope.sellerId)) {
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
        createdBy: input.createdById
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
