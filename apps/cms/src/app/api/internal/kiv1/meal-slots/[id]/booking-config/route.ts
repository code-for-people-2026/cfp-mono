import { mealSlotBookingConfigSchema } from "@cfp/kith-inn-v1-shared/api";
import { NextResponse } from "next/server";
import {
  findOwned,
  hasServiceClosure,
  hasSellerField,
  lockSellerDate,
  operatorScope,
  requireServiceAuth,
  withKiv1Transaction
} from "@/lib/kiv1-internal";
import { KIV1_AVAILABILITY_CHECKED } from "@/lib/kiv1-meal-slot-menu-guard";
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
  const current = await findOwned(scope.payload, "kiv1_meal_slots", id, scope.sellerId) as
    Parameters<typeof normalizeMealSlot>[0] | undefined;
  if (!current) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  try {
    const update = async (
      data = parsed.data,
      transactionReq?: Parameters<typeof hasServiceClosure>[1]
    ) => scope.payload.update({
      collection: "kiv1_meal_slots", id, data, overrideAccess: true,
      ...(data.orderStatus === "open" ? { context: { [KIV1_AVAILABILITY_CHECKED]: true } } : {}),
      ...(transactionReq ? { req: transactionReq } : {})
    });
    const doc = parsed.data.orderStatus === "open"
      ? await withKiv1Transaction(scope.payload, async (transactionReq) => {
        await lockSellerDate(scope.payload, transactionReq, scope.sellerId, current.date);
        const latest = await findOwned(scope.payload, "kiv1_meal_slots", id, scope.sellerId, transactionReq) as
          Parameters<typeof normalizeMealSlot>[0] | undefined;
        let price = Object.hasOwn(parsed.data, "priceCents")
          ? parsed.data.priceCents
          : latest?.priceCents;
        if (!Number.isSafeInteger(price)) {
          const sellers = await scope.payload.find({
            collection: "kiv1_sellers",
            where: { id: { equals: scope.sellerId } },
            limit: 1,
            depth: 0,
            overrideAccess: true,
            req: transactionReq
          });
          const defaultPrice = (sellers.docs[0] as
            { defaultPriceCents?: unknown } | undefined)?.defaultPriceCents;
          price = typeof defaultPrice === "number" ? defaultPrice : undefined;
        }
        const deadline = Object.hasOwn(parsed.data, "orderDeadline")
          ? parsed.data.orderDeadline
          : latest?.orderDeadline;
        if (!latest || !Array.isArray(latest.menuItems) || latest.menuItems.length !== 5 || !Number.isSafeInteger(price) ||
          typeof deadline !== "string" || Date.parse(deadline) <= Date.now()) {
          return NextResponse.json({ error: "meal-slot-not-openable", message: "餐次菜单、价格或截止时间不完整" }, { status: 409 });
        }
        if (await hasServiceClosure(scope.payload, transactionReq, scope.sellerId, latest.date, latest.occasion)) {
          return NextResponse.json({ error: "service-closure-conflict", message: "该餐次已安排打烊" }, { status: 409 });
        }
        return update({ ...parsed.data, priceCents: price as number }, transactionReq);
      })
      : await update(parsed.data);
    if (doc instanceof NextResponse) return doc;
    return NextResponse.json({ doc: normalizeMealSlot(doc as Parameters<typeof normalizeMealSlot>[0]) });
  } catch (error) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 409) {
      return NextResponse.json({ error: "meal-slot-booking-conflict" }, { status: 409 });
    }
    return NextResponse.json({ error: "meal-slot-booking-config-failed" }, { status: 500 });
  }
}
