import { isAuthorizedOperator } from "../access/tenantScoped";

/**
 * Minimal beforeChange-call shape: only what the stamp logic reads. The exported
 * function is cast to Payload's `CollectionBeforeChangeHook` at the collection
 * site (see Offerings.ts), keeping it directly callable in tests with a plain
 * `{ data, req: { user } }`.
 */
type BeforeChangeArgs = {
  data: Record<string, unknown> | undefined;
  req: { user?: unknown };
};

/**
 * Write-side tenant nailing (Tech Spec §3.1). Before any tenant-scoped collection
 * row is written, force `seller` to the authenticated operator's seller, ignoring
 * whatever the request body supplied. Without this, a crafted payload could place
 * a row under another tenant even though the access layer allowed the create.
 *
 * Pairs with the cross-tenant relationship guard (PR2): this pins the row's own
 * tenant; that guard pins every relationship the row points at.
 */
export function stampSeller({ data, req }: BeforeChangeArgs): Record<string, unknown> {
  const record = (data ?? {}) as Record<string, unknown>;
  if (!isAuthorizedOperator(req.user)) return record;
  return { ...record, seller: req.user.seller };
}
