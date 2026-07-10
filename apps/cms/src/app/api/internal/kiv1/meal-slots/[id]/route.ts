import { mealSlotUpdateSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import { findOwned, hasSellerField, operatorScope } from "@/lib/kiv1-internal";
import {
  normalizeMealSlot,
  ownsMenuItems,
  storedMenuItems
} from "../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  const doc = await findOwned(scope.payload, "kiv1_meal_slots", id, scope.sellerId);
  return doc
    ? NextResponse.json({ doc: normalizeMealSlot(doc as Parameters<typeof normalizeMealSlot>[0]) })
    : NextResponse.json({ error: "not-found" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const scope = await operatorScope(req);
  if (scope instanceof NextResponse) return scope;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const parsed = mealSlotUpdateSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-meal-slot-update" }, { status: 422 });
  }
  const { id } = await params;
  if (!await findOwned(scope.payload, "kiv1_meal_slots", id, scope.sellerId)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (!await ownsMenuItems(scope.payload, parsed.data.menuItems, scope.sellerId)) {
    return NextResponse.json({ error: "invalid-menu-offering" }, { status: 422 });
  }
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_meal_slots",
      id,
      data: {
        menuItems: storedMenuItems(parsed.data.menuItems),
        generatedAt: parsed.data.generatedAt
      },
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeMealSlot(doc as Parameters<typeof normalizeMealSlot>[0]) });
  } catch {
    return NextResponse.json({ error: "meal-slot-update-failed" }, { status: 500 });
  }
}
