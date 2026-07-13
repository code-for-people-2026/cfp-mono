/**
 * be → cms internal calls for the order domain (PR1 write chain). Every call
 * carries the operator JWT in `x-kith-inn-operator`; cms verifies it and scopes
 * writes to the JWT's sellerId (seller-token passthrough — NO admin key, §3.1).
 * Shapes here are the be↔cms internal contract (normalized by cms, not raw
 * Payload depth docs); FE-facing types live in @cfp/kith-inn-shared.
 */
import type {
  Fulfillment,
  FulfillmentStatus,
  Occasion,
  Order,
  OrderReconciliationRequest,
  OrderReconciliationResult,
  OrderItem,
  OrderSource,
  OrderStatus,
  Seller,
  ServiceSlot,
  ServiceSlotGranularity,
} from "@cfp/kith-inn-shared";
import { cmsBase, OPERATOR_JWT_HEADER, type CmsDeps } from "./client";

// ---- input / normalized shapes ----

export type DraftItemInput = {
  offering: string | number;
  quantity: number;
  unitPriceCents?: number;
  note?: string;
};

export type CreateDraftInput = {
  customer: string | number;
  date: string;
  occasion: Occasion;
  source: OrderSource;
  note?: string;
  idempotencyKey?: string;
  items: DraftItemInput[];
  totalCents: number;
};

export type OrderUpdatePatch = Partial<{
  paymentStatus: Order["paymentStatus"];
  paymentMethod: string;
  paidAt: string;
  date: string;
  occasion: Occasion;
  note: string;
}>;

export type SlotUpsertInput = {
  date: string;
  occasion?: Occasion;
  granularity: ServiceSlotGranularity;
};

export type FulfillmentInput = {
  order: string | number;
  serviceDate: string;
  occasion?: Occasion;
  status: FulfillmentStatus;
};

/** Normalized order load for confirm/cancel (cms flattens Payload's depth population). */
export type OrderDetail = {
  id: string | number;
  date: string;
  occasion: Occasion;
  status: OrderStatus;
  /** Frozen delivery-address snapshot (cms froze it at draft-create from the customer). */
  address?: string;
  customer: { id: string | number; address?: string };
  items: Array<{ id: string | number; quantity: number }>;
};

export type ReconciliationOrderRead = Order & {
  updatedAt: string;
  items: Array<{ id: string | number; offering: string | number | { id: string | number }; quantity: number; unitPriceCents?: number }>;
};

// ---- helpers ----

/** A non-2xx from a cms internal endpoint. Carries `status` so callers (e.g. the
 *  order service) can distinguish e.g. 409 archived-slot from a real failure. */
export class CmsHttpError extends Error {
  constructor(public status: number, label: string, public code?: string) {
    super(`${label} failed: ${status}`);
    this.name = "CmsHttpError";
  }
}

const jsonHeaders = (jwt: string) => ({
  [OPERATOR_JWT_HEADER]: jwt,
  "content-type": "application/json",
});

/** Resolve the fetch impl — injected for tests, global fetch in prod. One branch, shared by all calls. */
const fetchOf = (deps: CmsDeps): typeof fetch => deps.fetch ?? fetch;

async function parseOk<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json().catch(() => undefined)) as { error?: string } | T | undefined;
  const code = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  if (!res.ok) throw new CmsHttpError(res.status, label, code);
  return body as T;
}

// ---- reads ----

/** GET /api/internal/seller — the operator's seller config (pricing/menu/manifest). */
export async function getSeller(operatorJwt: string, deps: CmsDeps = {}): Promise<Seller> {
  const fetchImpl = fetchOf(deps);
  return parseOk(await fetchImpl(`${cmsBase()}/api/internal/seller`, { headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }), "cms seller lookup");
}

/** GET /api/internal/fulfillments[?date=&occasion=] — the seller's fulfillments (送餐 tab 数据源). */
export async function listFulfillments(
  operatorJwt: string,
  query: { date?: string; occasion?: string } = {},
  deps: CmsDeps = {},
): Promise<Fulfillment[]> {
  const fetchImpl = fetchOf(deps);
  const qs = new URLSearchParams();
  if (query.date) qs.set("date", query.date);
  if (query.occasion) qs.set("occasion", query.occasion);
  const tail = qs.toString();
  const json = await parseOk<{ docs?: Fulfillment[] }>(
    await fetchImpl(`${cmsBase()}/api/internal/fulfillments${tail ? `?${tail}` : ""}`, { headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }),
    "cms fulfillments list",
  );
  return json.docs ?? [];
}

/** GET /api/internal/orders/:id — normalized order + items + customer (confirm/cancel load). */
export async function getOrder(operatorJwt: string, id: string | number, deps: CmsDeps = {}): Promise<OrderDetail> {
  const fetchImpl = fetchOf(deps);
  return parseOk(await fetchImpl(`${cmsBase()}/api/internal/orders/${id}`, { headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }), "cms order lookup");
}

/** GET /api/internal/orders — the seller's orders for a date (+optional occasion/status filter). */
export async function listOrders(
  operatorJwt: string,
  query: { date?: string; occasion?: Occasion; status?: OrderStatus } = {},
  deps: CmsDeps = {},
): Promise<ReconciliationOrderRead[]> {
  const fetchImpl = fetchOf(deps);
  const qs = new URLSearchParams();
  if (query.date) qs.set("date", query.date);
  if (query.occasion) qs.set("occasion", query.occasion);
  if (query.status) qs.set("status", query.status);
  const tail = qs.toString();
  const json = await parseOk<{ docs?: ReconciliationOrderRead[] }>(
    await fetchImpl(`${cmsBase()}/api/internal/orders${tail ? `?${tail}` : ""}`, { headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }),
    "cms orders list",
  );
  return json.docs ?? [];
}

/** POST one immutable preview to CMS for fingerprint validation + atomic application. */
export async function reconcileOrders(
  operatorJwt: string,
  input: OrderReconciliationRequest,
  deps: CmsDeps = {},
): Promise<OrderReconciliationResult> {
  const fetchImpl = fetchOf(deps);
  return parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/orders/reconcile`, { method: "POST", headers: jsonHeaders(operatorJwt), body: JSON.stringify(input) }),
    "cms order reconcile",
  );
}

// ---- writes ----

/** POST /api/internal/orders — create a draft order + its items (prices snapshotted). */
export async function createOrderDraft(
  operatorJwt: string,
  input: CreateDraftInput,
  deps: CmsDeps = {},
): Promise<{ order: Order; items: OrderItem[] }> {
  const fetchImpl = fetchOf(deps);
  return parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/orders`, { method: "POST", headers: jsonHeaders(operatorJwt), body: JSON.stringify(input) }),
    "cms order create",
  );
}

export type ConfirmOrderResult = { slots: ServiceSlot[]; fulfillments: Fulfillment[]; alreadyConfirmed?: boolean };

/** POST /api/internal/orders/:id/confirm — atomic slot + fulfillment + order transition. */
export async function confirmOrderAtomic(
  operatorJwt: string,
  id: string | number,
  deps: CmsDeps = {},
): Promise<ConfirmOrderResult> {
  const fetchImpl = fetchOf(deps);
  return parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/orders/${id}/confirm`, { method: "POST", headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }),
    "cms order confirm",
  );
}

/** POST /api/internal/orders/:id/cancel — atomic fulfillment + order cancellation. */
export async function cancelOrderAtomic(operatorJwt: string, id: string | number, deps: CmsDeps = {}): Promise<void> {
  const fetchImpl = fetchOf(deps);
  await parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/orders/${id}/cancel`, { method: "POST", headers: { [OPERATOR_JWT_HEADER]: operatorJwt } }),
    "cms order cancel",
  );
}

/** PATCH /api/internal/orders/:id — update ordinary payment/date/occasion/note fields. */
export async function updateOrder(
  operatorJwt: string,
  id: string | number,
  patch: OrderUpdatePatch,
  deps: CmsDeps = {},
): Promise<Order> {
  const fetchImpl = fetchOf(deps);
  return parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/orders/${id}`, { method: "PATCH", headers: jsonHeaders(operatorJwt), body: JSON.stringify(patch) }),
    "cms order update",
  );
}

/** POST /api/internal/service-slots/upsert — open slots (409 if any is archived → needs force). */
export async function upsertSlots(operatorJwt: string, slots: SlotUpsertInput[], deps: CmsDeps = {}): Promise<ServiceSlot[]> {
  const fetchImpl = fetchOf(deps);
  return parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/service-slots/upsert`, { method: "POST", headers: jsonHeaders(operatorJwt), body: JSON.stringify(slots) }),
    "cms slot upsert",
  );
}

/** POST /api/internal/fulfillments — batch-create fulfillments (one per confirmed order). */
export async function createFulfillments(operatorJwt: string, items: FulfillmentInput[], deps: CmsDeps = {}): Promise<Fulfillment[]> {
  const fetchImpl = fetchOf(deps);
  return parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/fulfillments`, { method: "POST", headers: jsonHeaders(operatorJwt), body: JSON.stringify(items) }),
    "cms fulfillment create",
  );
}

/** PATCH /api/internal/fulfillments — set status on exact fulfillment ids (delivery mark-done). */
export async function setFulfillmentsByIds(
  operatorJwt: string,
  ids: Array<string | number>,
  set: { status: FulfillmentStatus },
  deps: CmsDeps = {},
): Promise<void> {
  const fetchImpl = fetchOf(deps);
  await parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/fulfillments`, { method: "PATCH", headers: jsonHeaders(operatorJwt), body: JSON.stringify({ ids, set }) }),
    "cms fulfillment update",
  );
}

/** PATCH /api/internal/fulfillments — set status on fulfillments whose order ∈ ids (cancel). */
export async function setFulfillmentsByOrders(
  operatorJwt: string,
  orderIds: Array<string | number>,
  set: { status: FulfillmentStatus },
  deps: CmsDeps = {},
): Promise<void> {
  const fetchImpl = fetchOf(deps);
  await parseOk(
    await fetchImpl(`${cmsBase()}/api/internal/fulfillments`, { method: "PATCH", headers: jsonHeaders(operatorJwt), body: JSON.stringify({ orderIn: orderIds, set }) }),
    "cms fulfillment update",
  );
}
