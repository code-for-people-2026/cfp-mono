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
  setFulfillmentsByOrders(jwt: string, ids: Array<string | number>, set: { status: FulfillmentStatus }): Promise<void>;
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
  occasion: Occasion;
  source: OrderSource;
  note?: string;
  idempotencyKey?: string;
  items: Array<{ offering: string | number; quantity: number; note?: string }>;
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
    quantity: it.quantity,
    unitPriceCents: resolveUnitPrice({ unitPriceCents: undefined }, offeringMap.get(String(it.offering)), seller),
    note: it.note,
  }));
  return cms.createOrderDraft(jwt, {
    customer: input.customer,
    date: input.date,
    occasion: input.occasion,
    source: input.source,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
    items,
    totalCents: computeTotalCents(items),
  });
}

export type ConfirmResult = { slots: ServiceSlot[]; fulfillments: Fulfillment[] };

/**
 * Materialize a draft into经营状态 (§3.3 ②): open the order's occasion slot,
 * create one fulfillment for the order, then flip the order to confirmed.
 * `archived` slots refuse auto-reopen (cms 409) →
 * surfaces as `OrderStateError("slot-archived")` (needs explicit force 二次确认).
 */
export async function confirmOrder(jwt: string, orderId: string | number, cms: OrderCms): Promise<ConfirmResult> {
  const detail = await cms.getOrder(jwt, orderId);
  if (detail.status !== "draft") throw new OrderStateError("not-draft");

  // ponytail: 桃子 is occasion-granularity; derive granularity from seller config
  // when a time-slot merchant actually exists.
  const granularity: ServiceSlotGranularity = "occasion";
  const slotInputs: SlotUpsertInput[] = [{
    date: detail.date,
    occasion: detail.occasion,
    granularity,
  }];
  let slots: ServiceSlot[];
  try {
    slots = slotInputs.length > 0 ? await cms.upsertSlots(jwt, slotInputs) : [];
  } catch (e) {
    if (e instanceof CmsHttpError && e.status === 409) throw new OrderStateError("slot-archived");
    throw e;
  }

  const fulfillments = await cms.createFulfillments(jwt, [{
    order: detail.id,
    serviceDate: detail.date,
    occasion: detail.occasion,
    status: "pending",
  }]);

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
  await cms.setFulfillmentsByOrders(jwt, [detail.id], { status: "canceled" });
  await cms.updateOrder(jwt, orderId, { status: "canceled" });
}
