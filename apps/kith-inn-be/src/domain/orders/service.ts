/**
 * Order lifecycle service (PRD §7.1 / Tech Spec §3.3 ①②). be is the SOLE writer
 * of order/fulfillment state in MVP, so the §3.3 data-integrity invariants live
 * HERE in one place (ponytail: not duplicated as cms hooks until a 2nd writer
 * appears — e.g. the V1 subscription-materialization job). All methods are thin
 * orchestration over the injected `OrderCms`; the pricing logic is pure (pricing.ts).
 *
 * Lifecycle: `recordDraft` (pure record, zero side effects) → `confirmOrder`
 * (materialize: open slots + create fulfillments + status=confirmed) →
 * `cancelOrder` (status=canceled + fulfillments=canceled terminal). draft NEVER
 * touches slots/fulfillments, so an un-confirmed draft can't pollute "今天该做".
 */
import type {
  Fulfillment,
  FulfillmentStatus,
  Occasion,
  Offering,
  Order,
  OrderItem,
  OrderSource,
  Seller,
  ServiceSlot,
  ServiceSlotGranularity,
} from "@cfp/kith-inn-shared";
import { CmsHttpError } from "../../lib/cms/orders";
import type {
  CreateDraftInput,
  DraftItemInput,
  FulfillmentInput,
  OrderDetail,
  OrderUpdatePatch,
  SlotUpsertInput,
} from "../../lib/cms/orders";
import { computeTotalCents, resolveUnitPrice } from "./pricing";

/** The cms surface this service orchestrates over — injected so tests mock it. */
export type OrderCms = {
  getSeller(jwt: string): Promise<Seller>;
  findOfferings(jwt: string): Promise<Offering[]>;
  getOrder(jwt: string, id: string | number): Promise<OrderDetail>;
  createOrderDraft(jwt: string, input: CreateDraftInput): Promise<{ order: Order; items: OrderItem[] }>;
  updateOrder(jwt: string, id: string | number, patch: OrderUpdatePatch): Promise<Order>;
  upsertSlots(jwt: string, slots: SlotUpsertInput[]): Promise<ServiceSlot[]>;
  createFulfillments(jwt: string, items: FulfillmentInput[]): Promise<Fulfillment[]>;
  setFulfillmentsByOrderItems(jwt: string, ids: Array<string | number>, set: { status: FulfillmentStatus }): Promise<void>;
};

/** Lifecycle errors the route maps to specific status codes. */
export class OrderStateError extends Error {
  constructor(public code: "not-draft" | "slot-archived") {
    super(code);
    this.name = "OrderStateError";
  }
}

export type RecordDraftInput = {
  customer: string | number;
  date: string;
  source: OrderSource;
  note?: string;
  idempotencyKey?: string;
  items: Array<{ offering: string | number; mealOccasion?: Occasion; quantity: number; note?: string }>;
};

/**
 * Resolve + snapshot unit prices and create a draft order with its items. Zero
 * side effects — no slot, no fulfillment (PRD §3.3 ①). Pricing snapshots here
 * (pricing.ts ponytail note): `unitPriceCents` per item + `totalCents` on order.
 */
export async function recordDraft(
  jwt: string,
  input: RecordDraftInput,
  cms: OrderCms,
): Promise<{ order: Order; items: OrderItem[] }> {
  const [seller, offerings] = await Promise.all([cms.getSeller(jwt), cms.findOfferings(jwt)]);
  const offeringMap = new Map(offerings.map((o) => [String(o.id), o]));
  const items: DraftItemInput[] = input.items.map((it) => ({
    offering: it.offering,
    mealOccasion: it.mealOccasion,
    quantity: it.quantity,
    unitPriceCents: resolveUnitPrice({ unitPriceCents: undefined }, offeringMap.get(String(it.offering)), seller),
    note: it.note,
  }));
  return cms.createOrderDraft(jwt, {
    customer: input.customer,
    date: input.date,
    source: input.source,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    items,
    totalCents: computeTotalCents(items),
  });
}

/** Distinct meal occasions across an order's items → one slot per occasion (桃子 = lunch/dinner). */
function distinctOccasions(detail: OrderDetail): Occasion[] {
  const seen = new Set<Occasion>();
  for (const it of detail.items) if (it.mealOccasion) seen.add(it.mealOccasion);
  return [...seen];
}

export type ConfirmResult = { slots: ServiceSlot[]; fulfillments: Fulfillment[] };

/**
 * Materialize a draft into经营状态 (§3.3 ②): open one slot per distinct occasion,
 * create a fulfillment per delivery/pickup item (self/onsite customers get none),
 * flip the order to confirmed. `archived` slots refuse auto-reopen (cms 409) →
 * surfaces as `OrderStateError("slot-archived")` (needs explicit force 二次确认).
 */
export async function confirmOrder(jwt: string, orderId: string | number, cms: OrderCms): Promise<ConfirmResult> {
  const detail = await cms.getOrder(jwt, orderId);
  if (detail.status !== "draft") throw new OrderStateError("not-draft");

  // ponytail: 桃子 is occasion-granularity; derive granularity from seller config
  // when a time-slot merchant actually exists.
  const granularity: ServiceSlotGranularity = "occasion";
  const slotInputs: SlotUpsertInput[] = distinctOccasions(detail).map((occasion) => ({
    date: detail.date,
    occasion,
    granularity,
  }));
  let slots: ServiceSlot[];
  try {
    slots = slotInputs.length > 0 ? await cms.upsertSlots(jwt, slotInputs) : [];
  } catch (e) {
    if (e instanceof CmsHttpError && e.status === 409) throw new OrderStateError("slot-archived");
    throw e;
  }

  // self/onsite customers (kind=self) get NO fulfillment — servings/purchasing
  // count via order_items, so they don't pollute gap reconciliation (§3.3 ②b).
  const fulfillmentInputs: FulfillmentInput[] =
    detail.customer.kind === "self"
      ? []
      : detail.items.map((it) => ({
          orderItem: it.id,
          serviceDate: detail.date,
          occasion: it.mealOccasion,
          mode: "delivery",
          status: "pending",
          addrBuilding: detail.customer.building,
          addrUnit: detail.customer.unit,
        }));
  const fulfillments = fulfillmentInputs.length > 0 ? await cms.createFulfillments(jwt, fulfillmentInputs) : [];

  await cms.updateOrder(jwt, orderId, { status: "confirmed" });
  return { slots, fulfillments };
}

/**
 * Cancel: order → canceled + all its fulfillments → canceled (terminal, exits the
 * delivery/gap口径). Idempotent — a second cancel on an already-canceled order is a no-op.
 */
export async function cancelOrder(jwt: string, orderId: string | number, cms: OrderCms): Promise<void> {
  const detail = await cms.getOrder(jwt, orderId);
  if (detail.status === "canceled") return;
  const itemIds = detail.items.map((it) => it.id);
  if (itemIds.length > 0) await cms.setFulfillmentsByOrderItems(jwt, itemIds, { status: "canceled" });
  await cms.updateOrder(jwt, orderId, { status: "canceled" });
}
