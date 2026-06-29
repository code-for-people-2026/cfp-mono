import type { Offering, OrderItem, Seller } from "@cfp/kith-inn-shared";

/**
 * Deterministic price resolution (PRD §7.1 定价解析). Unit-price priority:
 * `item.unitPriceCents` (这单特价/手填) → `offering.priceCents` (菜品定价) →
 * `seller.defaultPriceCents` (商家兜底, 桃子 = 3000). Pure — no I/O, fully tested.
 *
 * `// ponytail:` M1 snapshots the resolved price into `order_items.unitPriceCents`
 * at draft-create. PRD's confirm-time snapshot is a refinement for prices that
 * drift during a *long* draft window — not an MVP concern (drafts live minutes).
 * Upgrade to confirm-time snapshot if drafts ever span price changes.
 */
export function resolveUnitPrice(
  item: Pick<OrderItem, "unitPriceCents">,
  offering: Pick<Offering, "priceCents"> | undefined,
  seller: Pick<Seller, "defaultPriceCents"> | undefined,
): number {
  if (typeof item.unitPriceCents === "number") return item.unitPriceCents;
  if (offering?.priceCents !== undefined) return offering.priceCents;
  if (seller?.defaultPriceCents !== undefined) return seller.defaultPriceCents;
  // ponytail: nothing priced → 0 (free); sellers always carry defaultPriceCents in practice.
  return 0;
}

/**
 * `orders.totalCents` = Σ(quantity × unit price). The caller passes only the
 * order's live items — canceled orders/items are excluded upstream (PRD §7.1
 * "canceled 单不计入"), so this stays a dumb sum.
 */
export function computeTotalCents(
  items: Array<Pick<OrderItem, "quantity" | "unitPriceCents">>,
): number {
  return items.reduce((sum, it) => sum + it.quantity * (it.unitPriceCents ?? 0), 0);
}
