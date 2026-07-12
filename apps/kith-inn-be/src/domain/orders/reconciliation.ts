import type {
  OrderReconciliationCandidate,
  OrderReconciliationPreview,
  OrderReconciliationScope,
} from "@cfp/kith-inn-shared";
import { fingerprintActiveOrders } from "@cfp/kith-inn-shared/orderReconciliation";
import { normalizeCustomerName } from "../customers/nameNormalize";

type Id = string | number;
type Relationship = Id | { id: Id };

export type ReconciliationOrder = {
  id: Id;
  customer: Id | { id: Id; displayName: string };
  date: string;
  occasion: "lunch" | "dinner";
  status: "draft" | "confirmed";
  paymentStatus: string;
  fulfillmentStatus?: string;
  updatedAt: string;
  items: Array<{ id: Id; offering: Relationship; quantity: number; unitPriceCents?: number }>;
};

type SnapshotItem = {
  customerName: string;
  date: string;
  occasion: "lunch" | "dinner";
  quantity: number;
};

type SnapshotPreviewInput = {
  scope: OrderReconciliationScope[];
  items: SnapshotItem[];
  customers: Array<{ id: Id; displayName: string }>;
  offering: Id;
  unitPriceCents: number;
  orders: ReconciliationOrder[];
  operationKey: string;
  allowEmptySnapshot?: boolean;
};

type IncrementPreviewInput = Omit<SnapshotPreviewInput, "allowEmptySnapshot"> & {
  operation: "add" | "set";
};

export class ReconciliationError extends Error {
  constructor(
    public code: "empty-snapshot" | "duplicate-coordinate" | "ambiguous-customer" | "outside-scope" | "inconsistent-order" | "duplicate-scope" | "invalid-quantity" | "settled-order",
    message: string,
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

const relationshipId = (value: Relationship): Id => typeof value === "object" ? value.id : value;
const coordinate = (customer: Id, date: string, occasion: string) => `${String(customer)}|${date.split("T")[0]!}|${occasion}`;
const scopeCoordinate = (date: string, occasion: string) => `${date.split("T")[0]!}|${occasion}`;
const assertReconciliationMutable = (order: ReconciliationOrder, customerName: string) => {
  if (order.paymentStatus !== "unpaid" || (order.status === "confirmed" && order.fulfillmentStatus !== "pending")) {
    throw new ReconciliationError("settled-order", `${customerName} 的订单已付款或已送达，请单独处理`);
  }
};

export { fingerprintActiveOrders } from "@cfp/kith-inn-shared/orderReconciliation";

export function buildSnapshotPreview(input: SnapshotPreviewInput): OrderReconciliationPreview {
  if (input.items.length === 0 && !input.allowEmptySnapshot) {
    throw new ReconciliationError("empty-snapshot", "没有可信订单时不能推断为清空");
  }
  const scopeSet = new Set<string>();
  for (const entry of input.scope) {
    const key = scopeCoordinate(entry.date, entry.occasion);
    if (scopeSet.has(key)) throw new ReconciliationError("duplicate-scope", `重复范围：${key}`);
    scopeSet.add(key);
  }

  const customersByName = new Map<string, Array<{ id: Id; displayName: string }>>();
  for (const customer of input.customers) {
    const key = normalizeCustomerName(customer.displayName);
    customersByName.set(key, [...(customersByName.get(key) ?? []), customer]);
  }

  const candidates: OrderReconciliationCandidate[] = [];
  const candidateNames = new Map<string, string>();
  const candidateKeys = new Set<string>();
  for (const parsed of input.items) {
    if (!Number.isInteger(parsed.quantity) || parsed.quantity <= 0) {
      throw new ReconciliationError("invalid-quantity", `${parsed.customerName} 的份数必须为正整数`);
    }
    if (!scopeSet.has(scopeCoordinate(parsed.date, parsed.occasion))) {
      throw new ReconciliationError("outside-scope", `${parsed.customerName} 不在接龙范围内`);
    }
    const normalizedName = normalizeCustomerName(parsed.customerName);
    const matches = customersByName.get(normalizedName) ?? [];
    if (matches.length > 1) throw new ReconciliationError("ambiguous-customer", `${parsed.customerName} 匹配到多个顾客`);
    const matched = matches[0];
    const identity = matched ? String(matched.id) : `new:${normalizedName}`;
    const key = coordinate(identity, parsed.date, parsed.occasion);
    if (candidateKeys.has(key)) throw new ReconciliationError("duplicate-coordinate", `${parsed.customerName} 的订单重复`);
    candidateKeys.add(key);
    candidateNames.set(key, matched?.displayName ?? parsed.customerName.trim());
    candidates.push({
      ...(matched ? { customer: matched.id } : { newCustomer: { displayName: parsed.customerName.trim() } }),
      date: parsed.date,
      occasion: parsed.occasion,
      quantity: parsed.quantity,
      offering: input.offering,
      unitPriceCents: input.unitPriceCents,
      totalCents: input.unitPriceCents * parsed.quantity,
    });
  }

  const activeOrders = input.orders.filter((order) => scopeSet.has(scopeCoordinate(order.date, order.occasion)));
  const currentByCoordinate = new Map<string, ReconciliationOrder>();
  for (const order of activeOrders) {
    const key = coordinate(relationshipId(order.customer), order.date, order.occasion);
    if (order.items.length !== 1 || currentByCoordinate.has(key)) {
      throw new ReconciliationError("inconsistent-order", `active order ${String(order.id)} 不满足唯一订单明细约束`);
    }
    currentByCoordinate.set(key, order);
  }

  const rows: OrderReconciliationPreview["rows"] = candidates.map((candidate) => {
    const identity = candidate.customer === undefined
      ? `new:${normalizeCustomerName(candidate.newCustomer!.displayName)}`
      : String(candidate.customer);
    const key = coordinate(identity, candidate.date, candidate.occasion);
    const current = currentByCoordinate.get(key);
    if (!current) {
      return {
        kind: "create",
        customerName: candidateNames.get(key)!,
        date: candidate.date,
        occasion: candidate.occasion,
        afterQuantity: candidate.quantity,
        affectsConfirmed: false,
      };
    }
    currentByCoordinate.delete(key);
    const currentItem = current.items[0]!;
    const unchanged = currentItem.quantity === candidate.quantity
      && relationshipId(currentItem.offering) === candidate.offering;
    if (unchanged && currentItem.unitPriceCents !== undefined) {
      candidate.unitPriceCents = currentItem.unitPriceCents;
      candidate.totalCents = currentItem.unitPriceCents * candidate.quantity;
    }
    const name = typeof current.customer === "object" ? current.customer.displayName : candidateNames.get(key)!;
    if (!unchanged) assertReconciliationMutable(current, name);
    return {
      kind: unchanged ? "unchanged" : "update",
      customerName: name,
      date: candidate.date,
      occasion: candidate.occasion,
      beforeQuantity: currentItem.quantity,
      afterQuantity: candidate.quantity,
      orderStatus: current.status,
      affectsConfirmed: !unchanged && current.status === "confirmed",
    };
  });

  for (const current of currentByCoordinate.values()) {
    const name = typeof current.customer === "object" ? current.customer.displayName : String(relationshipId(current.customer));
    assertReconciliationMutable(current, name);
    rows.push({
      kind: "cancel",
      customerName: name,
      date: current.date,
      occasion: current.occasion,
      beforeQuantity: current.items[0]!.quantity,
      afterQuantity: 0,
      orderStatus: current.status,
      affectsConfirmed: current.status === "confirmed",
    });
  }

  return {
    mode: "snapshot",
    operationKey: input.operationKey,
    scope: input.scope,
    expectedFingerprint: fingerprintActiveOrders(activeOrders),
    candidates,
    rows,
  };
}

export function buildIncrementPreview(input: IncrementPreviewInput): OrderReconciliationPreview {
  if (input.scope.length !== 1 || input.items.length !== 1) {
    throw new ReconciliationError("invalid-quantity", "单笔补单必须只包含一个日期、餐次和顾客");
  }
  const parsed = input.items[0]!;
  const targetScope = input.scope[0]!;
  if (scopeCoordinate(parsed.date, parsed.occasion) !== scopeCoordinate(targetScope.date, targetScope.occasion)) {
    throw new ReconciliationError("outside-scope", `${parsed.customerName} 不在补单范围内`);
  }
  if (!Number.isInteger(parsed.quantity) || parsed.quantity <= 0) {
    throw new ReconciliationError("invalid-quantity", `${parsed.customerName} 的份数必须为正整数`);
  }

  const normalizedName = normalizeCustomerName(parsed.customerName);
  const matches = input.customers.filter((customer) => normalizeCustomerName(customer.displayName) === normalizedName);
  if (matches.length > 1) throw new ReconciliationError("ambiguous-customer", `${parsed.customerName} 匹配到多个顾客`);
  const matched = matches[0];
  const activeOrders = matched
    ? input.orders.filter((order) => coordinate(relationshipId(order.customer), order.date, order.occasion) === coordinate(matched.id, parsed.date, parsed.occasion))
    : [];
  const currentByCoordinate = new Map<string, ReconciliationOrder>();
  for (const order of activeOrders) {
    const key = coordinate(relationshipId(order.customer), order.date, order.occasion);
    if (order.items.length !== 1 || currentByCoordinate.has(key)) {
      throw new ReconciliationError("inconsistent-order", `active order ${String(order.id)} 不满足唯一订单明细约束`);
    }
    currentByCoordinate.set(key, order);
  }

  const current = matched ? currentByCoordinate.get(coordinate(matched.id, parsed.date, parsed.occasion)) : undefined;
  const beforeQuantity = current?.items[0]?.quantity ?? 0;
  const afterQuantity = input.operation === "add" ? beforeQuantity + parsed.quantity : parsed.quantity;
  const unchanged = current !== undefined
    && beforeQuantity === afterQuantity
    && relationshipId(current.items[0]!.offering) === input.offering;
  const customerName = matched?.displayName ?? parsed.customerName.trim();
  if (current && !unchanged) assertReconciliationMutable(current, customerName);
  const unitPriceCents = unchanged && current.items[0]!.unitPriceCents !== undefined
    ? current.items[0]!.unitPriceCents!
    : input.unitPriceCents;
  const candidate: OrderReconciliationCandidate = {
    ...(matched ? { customer: matched.id } : { newCustomer: { displayName: customerName } }),
    date: parsed.date,
    occasion: parsed.occasion,
    quantity: parsed.quantity,
    offering: input.offering,
    unitPriceCents,
    totalCents: unitPriceCents * parsed.quantity,
  };

  return {
    mode: "increment",
    operation: input.operation,
    operationKey: input.operationKey,
    scope: input.scope,
    expectedFingerprint: fingerprintActiveOrders(activeOrders),
    candidates: [candidate],
    rows: [{
      kind: current ? input.operation : "create",
      customerName,
      date: parsed.date,
      occasion: parsed.occasion,
      beforeQuantity,
      ...(input.operation === "add" ? { changeQuantity: parsed.quantity } : {}),
      afterQuantity,
      ...(current ? { orderStatus: current.status } : {}),
      affectsConfirmed: Boolean(current && !unchanged && current.status === "confirmed"),
    }],
  };
}
