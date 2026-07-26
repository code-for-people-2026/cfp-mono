import type { ServiceClosure } from "@cfp/kith-inn-v1-shared";
import {
  mealSlotRangeSchema,
  serviceClosureCreateSchema,
  serviceClosureListResponseSchema
} from "@cfp/kith-inn-v1-shared/api";
import type { BasePayload, PayloadRequest, Where } from "payload";
import { NextResponse } from "next/server";
import {
  hasSellerField,
  isUniqueConflict,
  lockSellerDate,
  operatorScope,
  requireServiceAuth,
  withKiv1Transaction
} from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type ClosureDoc = { id: string | number; seller: unknown; date: string; occasion?: unknown; note?: unknown };
const relationId = (value: unknown): string | number => typeof value === "object" && value !== null && "id" in value
  ? (value as { id: string | number }).id : value as string | number;

export const normalizeServiceClosure = (doc: ClosureDoc): ServiceClosure => ({
  id: doc.id,
  sellerId: relationId(doc.seller),
  date: doc.date,
  occasion: doc.occasion === "lunch" || doc.occasion === "dinner" ? doc.occasion : null,
  note: typeof doc.note === "string" && doc.note.length > 0 ? doc.note : null
});

const targetWhere = (date: string, occasion: "lunch" | "dinner" | null): Where[] => [
  { date: { equals: date } },
  ...(occasion === null ? [] : [{ occasion: { equals: occasion } } as Where])
];

async function targetHasOrders(
  payload: BasePayload,
  req: PayloadRequest,
  sellerId: string | number,
  date: string,
  occasion: "lunch" | "dinner" | null
): Promise<boolean> {
  const slots = await payload.find({
    collection: "kiv1_meal_slots",
    where: { and: [{ seller: { equals: sellerId } }, ...targetWhere(date, occasion)] },
    limit: 0,
    depth: 0,
    overrideAccess: true,
    req
  });
  if (slots.docs.length === 0) return false;
  const orders = await payload.find({
    collection: "kiv1_orders",
    where: { and: [
      { seller: { equals: sellerId } },
      { mealSlot: { in: slots.docs.map(({ id }) => id) } },
      { status: { in: ["draft", "confirmed"] } }
    ] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req
  });
  return orders.docs.length > 0;
}

export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const url = new URL(req.url);
  const parsed = mealSlotRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: "invalid-service-closure-range" }, { status: 400 });
  const result = await scope.payload.find({
    collection: "kiv1_service_closures",
    where: { and: [
      { seller: { equals: scope.sellerId } },
      { date: { greater_than_equal: parsed.data.from } },
      { date: { less_than_equal: parsed.data.to } }
    ] },
    sort: ["date", "occasion"],
    limit: 0,
    depth: 0,
    overrideAccess: true
  });
  return NextResponse.json(serviceClosureListResponseSchema.parse({
    docs: (result.docs as ClosureDoc[]).map(normalizeServiceClosure)
  }));
}

export async function POST(req: Request) {
  const serviceError = requireServiceAuth(req);
  if (serviceError) return serviceError;
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid-json" }, { status: 400 }); }
  const parsed = serviceClosureCreateSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-service-closure" }, { status: 422 });
  }
  const input = parsed.data;
  try {
    return await withKiv1Transaction(scope.payload, async (transactionReq) => {
      await lockSellerDate(scope.payload, transactionReq, scope.sellerId, input.date);
      const closures = await scope.payload.find({
        collection: "kiv1_service_closures",
        where: { and: [
          { seller: { equals: scope.sellerId } },
          { date: { equals: input.date } },
          ...(input.occasion === null ? [] : [{ or: [
            { occasion: { equals: null } }, { occasion: { equals: input.occasion } }
          ] } as Where])
        ] },
        limit: 1, depth: 0, overrideAccess: true, req: transactionReq
      });
      if (closures.docs.length > 0) {
        return NextResponse.json({ error: "service-closure-conflict", message: "该日期已有打烊安排" }, { status: 409 });
      }
      const openSlots = await scope.payload.find({
        collection: "kiv1_meal_slots",
        where: { and: [
          { seller: { equals: scope.sellerId } }, ...targetWhere(input.date, input.occasion),
          { orderStatus: { equals: "open" } }
        ] },
        limit: 1, depth: 0, overrideAccess: true, req: transactionReq
      });
      if (openSlots.docs.length > 0 || await targetHasOrders(
        scope.payload, transactionReq, scope.sellerId, input.date, input.occasion
      )) {
        return NextResponse.json({ error: "service-closure-in-use", message: "对应餐次已开放或已有订单" }, { status: 409 });
      }
      const doc = await scope.payload.create({
        collection: "kiv1_service_closures",
        data: { seller: scope.sellerId, ...input },
        overrideAccess: true,
        req: transactionReq
      });
      return NextResponse.json({ doc: normalizeServiceClosure(doc as ClosureDoc) }, { status: 201 });
    });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "service-closure-conflict" }, { status: 409 })
      : NextResponse.json({ error: "service-closure-create-failed" }, { status: 500 });
  }
}
