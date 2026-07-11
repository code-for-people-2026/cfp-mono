import { mealSlotBookingConfigSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import {
  findOwned,
  hasSellerField,
  operatorScope,
  requireServiceAuth
} from "@/lib/kiv1-internal";
import { normalizeMealSlot } from "../../route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteContext) {
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
  const parsed = mealSlotBookingConfigSchema.safeParse(body);
  if (hasSellerField(body) || !parsed.success) {
    return NextResponse.json({ error: "invalid-meal-slot-booking-config" }, { status: 422 });
  }
  const { id } = await params;
  if (!await findOwned(scope.payload, "kiv1_meal_slots", id, scope.sellerId)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  try {
    const doc = await scope.payload.update({
      collection: "kiv1_meal_slots",
      id,
      data: parsed.data,
      overrideAccess: true
    });
    return NextResponse.json({ doc: normalizeMealSlot(doc as Parameters<typeof normalizeMealSlot>[0]) });
  } catch {
    return NextResponse.json({ error: "meal-slot-booking-config-failed" }, { status: 500 });
  }
}
