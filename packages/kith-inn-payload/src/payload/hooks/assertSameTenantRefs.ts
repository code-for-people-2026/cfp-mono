import type { Field } from "payload";
import { readSellerId, sellerIdOf } from "../lib/buildSellerWhere";

/** A relationship reference extracted from a doc's data: target collection + id. */
type RelationshipRef = { relationTo: string; id: string | number };

/**
 * Walk a doc's data against its collection's field configs and collect every
 * relationship value as `{ relationTo, id }` — flattening arrays and populated
 * `{ id }` shapes. Handles both relationship shapes:
 *  - single-target (`relationTo: string`): value is a bare id or populated `{ id }`;
 *  - polymorphic (`relationTo: string[]`): Payload stores the value as
 *    `{ relationTo, value }` — the embedded `relationTo` is the chosen target
 *    (NOT fanned out to every allowed target) and `value` is the id / `{ id }`.
 * Pure (no Payload), so it's unit-tested directly.
 *
 * Scope: top-level relationship fields only (the spine's key refs —
 * `order.customer`, `order_item.offering`, etc.). Nested relationships inside
 * arrays/groups/blocks are intentionally not walked here; add when a real
 * nested cross-tenant ref appears.
 */
export function collectRelationshipRefs(
  data: Record<string, unknown> | undefined,
  fields: Field[] | undefined,
): RelationshipRef[] {
  if (!data || !fields) return [];
  const refs: RelationshipRef[] = [];
  for (const field of fields) {
    if (field.type !== "relationship") continue;
    const name = field.name;
    if (!name || !(name in data)) continue;
    const isPolymorphic = Array.isArray(field.relationTo);
    const values = Array.isArray(data[name]) ? (data[name] as unknown[]) : [data[name]];
    for (const raw of values) {
      if (isPolymorphic) {
        // Polymorphic ref is stored as { relationTo, value }.
        if (typeof raw !== "object" || raw === null || !("relationTo" in raw)) continue;
        const target = (raw as { relationTo: unknown }).relationTo;
        const id = extractId((raw as { value?: unknown }).value);
        if (typeof target === "string" && id !== null) refs.push({ relationTo: target, id });
      } else {
        const id = extractId(raw);
        if (id !== null) refs.push({ relationTo: field.relationTo as string, id });
      }
    }
  }
  return refs;
}

/** Read an id off a relationship value: a bare id or a populated `{ id }`. */
function extractId(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}

/**
 * Minimal beforeChange-call shape (mirrors `stampSeller`): only what the guard
 * reads. Cast to Payload's `CollectionBeforeChangeHook` at the collection site.
 */
type BeforeChangeArgs = {
  data: Record<string, unknown> | undefined;
  collection: { slug: string; fields?: Field[] };
  req: {
    user?: unknown;
    payload: {
      findByID: (args: {
        collection: string;
        id: string | number;
        overrideAccess: boolean;
      }) => Promise<unknown>;
    };
  };
};

/**
 * Cross-tenant relationship guard (Tech Spec §3.1). Before a tenant-scoped doc is
 * written, reject any relationship that points at ANOTHER seller's doc. Without
 * this, operator A could set `order.customer = <B's customer id>` and then read
 * B's customer address via `depth > 0` populate — bypassing `customers`' own
 * access. The stampSeller hook pins the row's own seller; THIS hook pins every
 * relationship the row points at.
 *
 * A referenced doc with no `seller` field (e.g. the `sellers` tenant root, or a
 * non-tenant collection) is skipped — only tenant-scoped targets are checked.
 */
export async function assertSameTenantRefs({
  data,
  req,
  collection,
}: BeforeChangeArgs): Promise<Record<string, unknown>> {
  const record = (data ?? {}) as Record<string, unknown>;
  const sellerId = sellerIdOf(req.user);
  if (sellerId === null) return record; // no operator → the access layer handles
  for (const { relationTo, id } of collectRelationshipRefs(record, collection.fields)) {
    const doc = (await req.payload.findByID({
      collection: relationTo,
      id,
      overrideAccess: true,
    })) as Record<string, unknown> | null;
    if (!doc) continue;
    if (!("seller" in doc)) continue; // target isn't tenant-scoped → skip
    const refSellerId = readSellerId(doc.seller);
    if (refSellerId !== null && refSellerId !== sellerId) {
      throw new Error(
        `cross-tenant reference blocked: ${collection.slug} → ${relationTo}:${id} belongs to seller ${refSellerId}, operator is seller ${sellerId}`,
      );
    }
  }
  return record;
}
