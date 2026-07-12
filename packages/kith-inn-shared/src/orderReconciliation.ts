type Id = string | number;
type Relationship = Id | { id: Id };

export type ActiveOrderFingerprintInput = {
  id: Id;
  customer: Relationship;
  date: string;
  occasion: string;
  status: string;
  paymentStatus: string;
  updatedAt: string;
  items: Array<{ id: Id; offering: Relationship; quantity: number; unitPriceCents?: number }>;
};

const relationshipId = (value: Relationship): Id => typeof value === "object" ? value.id : value;

/** Stable, lossless serialization; opaque to callers and collision-free for distinct canonical JSON. */
export function fingerprintActiveOrders(orders: ActiveOrderFingerprintInput[]): string {
  const canonical = orders.map((order) => ({
    id: String(order.id),
    customer: String(relationshipId(order.customer)),
    date: order.date.split("T")[0]!,
    occasion: order.occasion,
    status: order.status,
    paymentStatus: order.paymentStatus,
    updatedAt: order.updatedAt,
    items: order.items.map((entry) => ({
      id: String(entry.id),
      offering: String(relationshipId(entry.offering)),
      quantity: entry.quantity,
      unitPriceCents: entry.unitPriceCents ?? null,
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).sort((a, b) => `${a.customer}|${a.date}|${a.occasion}|${a.id}`.localeCompare(`${b.customer}|${b.date}|${b.occasion}|${b.id}`));
  return `v1:${JSON.stringify(canonical)}`;
}
