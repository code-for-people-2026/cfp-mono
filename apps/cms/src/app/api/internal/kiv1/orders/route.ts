import { cmsOrderCreateSchema } from "@cfp/kith-inn-v1-shared/api";
import type { Order } from "@cfp/kith-inn-v1-shared";
import { NextResponse } from "next/server";
import {
  findOwned,
  hasSellerField,
  isUniqueConflict,
  operatorScope
} from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type OrderDoc = {
  id: string | number;
  seller: unknown;
  mealSlot: unknown;
  customerProfile?: unknown | null;
  status: Order["status"];
  source: Order["source"];
  displayName: string;
  address?: string | null;
  quantity: number;
  unitPriceCents: number;
  paymentStatus: Order["paymentStatus"];
  paidAt?: string | null;
  deliveryStatus: Order["deliveryStatus"];
  deliveredAt?: string | null;
  confirmedAt?: string | null;
  canceledAt?: string | null;
  note?: string | null;
};

function relationshipId(value: unknown): string | number {
  return typeof value === "object" && value !== null && "id" in value
    ? (value as { id: string | number }).id
    : value as string | number;
}

function nullableRelationshipId(value: unknown): string | number | null {
  return value === null || value === undefined ? null : relationshipId(value);
}

export function normalizeOrder(doc: OrderDoc): Order {
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    mealSlotId: relationshipId(doc.mealSlot),
    customerProfileId: nullableRelationshipId(doc.customerProfile),
    status: doc.status,
    source: doc.source,
    displayName: doc.displayName,
    address: doc.source === "jielong-import" && !doc.address?.trim() ? null : doc.address ?? null,
    quantity: doc.quantity,
    unitPriceCents: doc.unitPriceCents,
    totalCents: doc.quantity * doc.unitPriceCents,
    paymentStatus: doc.paymentStatus,
    paidAt: doc.paidAt ?? null,
    deliveryStatus: doc.deliveryStatus,
    deliveredAt: doc.deliveredAt ?? null,
    confirmedAt: doc.confirmedAt ?? null,
    canceledAt: doc.canceledAt ?? null,
    note: doc.note ?? null
  };
}

async function requestJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false };
  }
}

export async function GET(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const rawMealSlotId = new URL(req.url).searchParams.get("mealSlotId");
  if (!rawMealSlotId) return NextResponse.json({ error: "invalid-meal-slot" }, { status: 400 });
  const mealSlotId = /^\d+$/.test(rawMealSlotId) ? Number(rawMealSlotId) : rawMealSlotId;
  if (!await findOwned(scope.payload, "kiv1_meal_slots", mealSlotId, scope.sellerId)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  const result = await scope.payload.find({
    collection: "kiv1_orders",
    where: { and: [
      { seller: { equals: scope.sellerId } },
      { mealSlot: { equals: mealSlotId } }
    ] },
    sort: ["address", "displayName"],
    limit: 0,
    depth: 0,
    overrideAccess: true
  });
  const docs = (result.docs as OrderDoc[]).map(normalizeOrder)
    .sort((left, right) => (left.address ?? "无地址").localeCompare(right.address ?? "无地址") ||
      left.displayName.localeCompare(right.displayName, "zh-CN") ||
      String(left.id).localeCompare(String(right.id)));
  return NextResponse.json({ docs });
}

export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const body = await requestJson(req);
  if (!body.ok) return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  const parsed = cmsOrderCreateSchema.safeParse(body.value);
  if (hasSellerField(body.value) || !parsed.success) {
    return NextResponse.json({ error: "invalid-order" }, { status: 422 });
  }
  const input = parsed.data;
  if (!await findOwned(scope.payload, "kiv1_meal_slots", input.mealSlotId, scope.sellerId) ||
    !await findOwned(scope.payload, "kiv1_customer_profiles", input.customerProfileId, scope.sellerId)) {
    return NextResponse.json({ error: "invalid-order-relationship" }, { status: 422 });
  }
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_orders",
      data: {
        seller: scope.sellerId,
        mealSlot: input.mealSlotId,
        customerProfile: input.customerProfileId,
        customerOpenid: input.customerOpenid,
        status: input.status,
        source: input.source,
        displayName: input.displayName,
        address: input.address,
        quantity: input.quantity,
        unitPriceCents: input.unitPriceCents,
        paymentStatus: input.paymentStatus,
        paidAt: input.paidAt,
        deliveryStatus: input.deliveryStatus,
        deliveredAt: input.deliveredAt,
        confirmedAt: input.confirmedAt,
        canceledAt: input.canceledAt,
        note: input.note
      },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeOrder(doc as OrderDoc) }, { status: 201 });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "order-conflict" }, { status: 409 })
      : NextResponse.json({ error: "order-create-failed" }, { status: 500 });
  }
}
