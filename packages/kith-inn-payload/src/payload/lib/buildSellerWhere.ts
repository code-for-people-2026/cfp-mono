import type { Where } from "payload";

/**
 * The authenticated operator shape as it appears on `req.user` after the login
 * trust root resolves `wx.login → openid → operator → seller` (Tech Spec §3.1).
 * `seller` is a relationship value: a bare id when shallow, or a populated doc
 * (`{ id }`) when `depth > 0`.
 */
export type OperatorUser = {
  id: string | number;
  seller: unknown;
  role: "owner" | "helper";
  active: boolean;
};

/** Is `user` shaped like an operator (has the tenant key + active flag)? */
export function isOperator(user: unknown): user is OperatorUser {
  if (typeof user !== "object" || user === null) return false;
  const u = user as Record<string, unknown>;
  return "seller" in u && "active" in u;
}

/**
 * Read the seller (tenant) id off an operator, tolerating both the shallow
 * (`number | string`) and populated (`{ id }`) relationship shapes. Returns
 * `null` for non-operators, inactive operators, or an unreadable seller.
 */
export function sellerIdOf(user: unknown): string | number | null {
  if (!isOperator(user)) return null;
  if (user.active !== true) return null;
  return readSellerId(user.seller);
}

/**
 * Read a seller id off an arbitrary value — used for a DOC's `seller` field
 * (a bare id or a populated `{ id }`), unlike `sellerIdOf` which is for the
 * operator shape. Exported so the cross-tenant ref guard can compare a
 * referenced doc's seller against the operator's.
 */
export function readSellerId(seller: unknown): string | number | null {
  if (typeof seller === "string" || typeof seller === "number") return seller;
  if (typeof seller === "object" && seller !== null && "id" in seller) {
    const id = (seller as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}

/**
 * Build the tenant-scoping `Where` clause for an operator's own seller (Tech Spec
 * §3.1 read-side isolation). Pure and SQL-safe: it returns a Payload `Where` that
 * the adapter parameterizes — it never emits raw SQL, so a missing seller cannot
 * silently broaden into a cross-tenant scan. Returns `null` when there is no
 * usable tenant; callers treat `null` as deny.
 */
export function buildSellerWhere(user: unknown): Where | null {
  const sellerId = sellerIdOf(user);
  if (sellerId === null) return null;
  return { seller: { equals: sellerId } };
}
