import {
  mealSlotCreateSchema,
  mealSlotRangeSchema
} from "@cfp/kith-inn-v1-shared/api";
import type { MealSlot, MenuItemSnapshot } from "@cfp/kith-inn-v1-shared";
import type { BasePayload } from "payload";
import { NextResponse } from "next/server";
import {
  findOwned,
  hasSellerField,
  isUniqueConflict,
  operatorScope
} from "@/lib/kiv1-internal";

export const dynamic = "force-dynamic";

type MealSlotDoc = {
  id: string | number;
  seller: unknown;
  date: string;
  occasion: MealSlot["occasion"];
  menuItems?: Array<{
    offering: unknown;
    nameSnapshot: string;
    mainIngredientSnapshot?: string | null;
    categorySnapshot: MenuItemSnapshot["categorySnapshot"];
  }> | null;
  orderStatus: MealSlot["orderStatus"];
  orderDeadline?: string | null;
  priceCents?: number | null;
  generatedAt?: string | null;
};

function relationshipId(value: unknown): string | number {
  return typeof value === "object" && value !== null && "id" in value
    ? (value as { id: string | number }).id
    : value as string | number;
}

export function normalizeMealSlot(doc: MealSlotDoc): MealSlot {
  return {
    id: doc.id,
    sellerId: relationshipId(doc.seller),
    date: doc.date,
    occasion: doc.occasion,
    menuItems: (doc.menuItems ?? []).map((item) => ({
      offeringId: relationshipId(item.offering),
      nameSnapshot: item.nameSnapshot,
      mainIngredientSnapshot: item.mainIngredientSnapshot ?? null,
      categorySnapshot: item.categorySnapshot
    })),
    orderStatus: doc.orderStatus,
    orderDeadline: doc.orderDeadline ?? null,
    priceCents: doc.priceCents ?? null,
    generatedAt: doc.generatedAt ?? null
  };
}

export const storedMenuItems = (menuItems: MenuItemSnapshot[]) => menuItems.map(({ offeringId, ...item }) => ({
  offering: offeringId,
  ...item
}));

export async function ownsMenuItems(
  payload: BasePayload,
  menuItems: MenuItemSnapshot[],
  sellerId: string | number
): Promise<boolean> {
  for (const item of menuItems) {
    if (!await findOwned(payload, "kiv1_offerings", item.offeringId, sellerId)) return false;
  }
  return true;
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
  const url = new URL(req.url);
  const parsed = mealSlotRangeSchema.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to")
  });
  if (!parsed.success) return NextResponse.json({ error: "invalid-date-range" }, { status: 400 });
  const result = await scope.payload.find({
    collection: "kiv1_meal_slots",
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
  return NextResponse.json({ docs: (result.docs as MealSlotDoc[]).map(normalizeMealSlot) });
}

export async function POST(req: Request) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const body = await requestJson(req);
  if (!body.ok) return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  const parsed = mealSlotCreateSchema.safeParse(body.value);
  if (hasSellerField(body.value) || !parsed.success) {
    return NextResponse.json({ error: "invalid-meal-slot" }, { status: 422 });
  }
  if (!await ownsMenuItems(scope.payload, parsed.data.menuItems, scope.sellerId)) {
    return NextResponse.json({ error: "invalid-menu-offering" }, { status: 422 });
  }
  try {
    const doc = await scope.payload.create({
      collection: "kiv1_meal_slots",
      data: {
        seller: scope.sellerId,
        date: parsed.data.date,
        occasion: parsed.data.occasion,
        menuItems: storedMenuItems(parsed.data.menuItems),
        generatedAt: parsed.data.generatedAt,
        orderStatus: "draft"
      },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeMealSlot(doc as MealSlotDoc) }, { status: 201 });
  } catch (error) {
    return isUniqueConflict(error)
      ? NextResponse.json({ error: "meal-slot-conflict" }, { status: 409 })
      : NextResponse.json({ error: "meal-slot-create-failed" }, { status: 500 });
  }
}
