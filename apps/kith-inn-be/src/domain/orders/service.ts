/**
 * Order lifecycle service (PRD §7.1 / Tech Spec §3.3 ①②). Pricing stays in be;
 * multi-write lifecycle invariants live in cms, the only process holding the
 * Payload/Postgres transaction. These methods are thin calls over `OrderCms`.
 *
 * Lifecycle: `recordDraft` → atomic cms draft+items; `confirmOrder` → atomic cms
 * slot+fulfillment+confirmed; `cancelOrder` → atomic cms terminal cancellation.
 */
import type {
  Occasion,
  Offering,
  Order,
  OrderItem,
  OrderSource,
  Seller,
} from "@cfp/kith-inn-shared";
import { CmsHttpError } from "../../lib/cms/orders";
import type {
  ConfirmOrderResult,
  CreateDraftInput,
  DraftItemInput,
  OrderDetail,
  OrderUpdatePatch,
} from "../../lib/cms/orders";
import { computeTotalCents, resolveUnitPrice } from "./pricing";

/** The cms surface this service orchestrates over — injected so tests mock it. */
export type OrderCms = {
  getSeller(jwt: string): Promise<Seller>;
  findOfferings(jwt: string): Promise<Offering[]>;
  getOrder(jwt: string, id: string | number): Promise<OrderDetail>;
  createOrderDraft(jwt: string, input: CreateDraftInput): Promise<{ order: Order; items: OrderItem[] }>;
  confirmOrderAtomic(jwt: string, id: string | number): Promise<ConfirmOrderResult>;
  cancelOrderAtomic(jwt: string, id: string | number): Promise<void>;
  updateOrder(jwt: string, id: string | number, patch: OrderUpdatePatch): Promise<Order>;
};

/** Lifecycle errors the route maps to specific status codes. */
export class OrderStateError extends Error {
  constructor(public code: "not-draft" | "slot-archived" | "empty-order") {
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
  if (input.items.length === 0) throw new OrderStateError("empty-order");
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

export type ConfirmResult = ConfirmOrderResult;

/**
 * Ask cms to materialize a draft into经营状态 (§3.3 ②) in one transaction.
 * `archived` slots refuse auto-reopen (cms 409) →
 * surfaces as `OrderStateError("slot-archived")` (needs explicit force 二次确认).
 */
export async function confirmOrder(jwt: string, orderId: string | number, cms: OrderCms): Promise<ConfirmResult> {
  try {
    return await cms.confirmOrderAtomic(jwt, orderId);
  } catch (e) {
    if (e instanceof CmsHttpError && e.status === 409) {
      if (e.code === "slot-archived") throw new OrderStateError("slot-archived");
      if (e.code === "empty-order") throw new OrderStateError("empty-order");
      if (e.code === "not-draft") throw new OrderStateError("not-draft");
    }
    throw e;
  }
}

/**
 * Cancel: order → canceled + all its fulfillments → canceled (terminal, exits the
 * delivery/gap口径). Idempotent — a second cancel on an already-canceled order is a no-op.
 */
export async function cancelOrder(jwt: string, orderId: string | number, cms: OrderCms): Promise<void> {
  await cms.cancelOrderAtomic(jwt, orderId);
}
