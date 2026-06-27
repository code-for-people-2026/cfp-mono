import type { Where } from "payload";
import { buildSellerWhere, sellerIdOf, type OperatorUser } from "../lib/buildSellerWhere";

/**
 * Minimal access-call shape: only what the tenant logic reads. A function with
 * this arg type is assignable to Payload's `Access` (contravariantly — a real
 * PayloadRequest carries `user`), but it can be invoked in tests with a plain
 * `{ req: { user } }` without constructing a full request.
 */
type AccessArgs = { req: { user?: unknown } };

type ScopedAccess = {
  // read / update / delete return a `Where` to scope the operation to the
  // operator's own seller (Tech Spec §3.1). Returning `true` from update/delete
  // would grant the op on ANY doc — letting an operator PATCH another seller's
  // row (then stampSeller re-stamps it into the attacker's tenant) or DELETE it.
  read: (args: AccessArgs) => Where | boolean;
  create: (args: AccessArgs) => boolean;
  update: (args: AccessArgs) => Where | boolean;
  delete: (args: AccessArgs) => Where | boolean;
};

/**
 * The hard tenant-isolation access factory (Tech Spec §3.1). Every kith-inn
 * business collection MUST register all four access functions through this
 * factory — a collection-traversal test (PR2) asserts that no `seller`-bearing
 * collection escapes it, so a forgotten table fails in CI rather than leaking
 * across tenants at runtime.
 *
 * Defense in depth:
 *  - `read`/`update`/`delete` are scoped to the operator's own seller via a
 *    `Where` clause (so an operator can neither read nor modify nor remove
 *    another seller's rows).
 *  - `create` is gated on an authorized operator here; the write side is then
 *    nailed down by the `stampSeller` beforeChange hook (forces
 *    `seller = operator.seller`) plus the cross-tenant relationship guard (PR2).
 *
 * Every function returns `false` (deny) when there is no authenticated, active
 * operator — the factory's default is deny, not allow.
 */
export function tenantScoped(): ScopedAccess {
  return {
    read: ({ req }) => buildSellerWhere(req.user) ?? false,
    create: ({ req }) => sellerIdOf(req.user) !== null,
    update: ({ req }) => buildSellerWhere(req.user) ?? false,
    delete: ({ req }) => buildSellerWhere(req.user) ?? false,
  };
}

/** Convenience guard: is `user` an active operator with a usable seller? */
export function isAuthorizedOperator(user: unknown): user is OperatorUser {
  return sellerIdOf(user) !== null;
}
