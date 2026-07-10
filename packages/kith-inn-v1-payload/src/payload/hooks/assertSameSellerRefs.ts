import type { Field } from "payload";

type RelationshipRef = { relationTo: string; id: string | number };

function idOf(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return null;
}

export function collectRelationshipRefs(
  data: Record<string, unknown> | undefined,
  fields: Field[] | undefined
): RelationshipRef[] {
  if (!data || !fields) return [];
  const refs: RelationshipRef[] = [];

  for (const field of fields) {
    if (!("name" in field) || !(field.name in data)) continue;
    const value = data[field.name];

    if (field.type === "relationship" && typeof field.relationTo === "string") {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        const id = idOf(item);
        if (id !== null) refs.push({ relationTo: field.relationTo, id });
      }
    } else if (field.type === "array" && Array.isArray(value)) {
      for (const row of value) {
        if (typeof row === "object" && row !== null) {
          refs.push(...collectRelationshipRefs(row as Record<string, unknown>, field.fields));
        }
      }
    }
  }

  return refs;
}

type BeforeChangeArgs = {
  data: Record<string, unknown> | undefined;
  originalDoc?: Record<string, unknown>;
  collection: { slug: string; fields?: Field[] };
  req: {
    payload: {
      findByID: (args: {
        collection: string;
        id: string | number;
        overrideAccess: boolean;
      }) => Promise<unknown>;
    };
  };
};

export async function assertSameSellerRefs({
  data,
  originalDoc,
  collection,
  req
}: BeforeChangeArgs): Promise<Record<string, unknown>> {
  const result = data ?? {};
  const completeDoc = { ...originalDoc, ...result };
  const sellerId = idOf(completeDoc.seller);
  if (sellerId === null) return result;

  for (const ref of collectRelationshipRefs(completeDoc, collection.fields)) {
    const target = await req.payload.findByID({
      collection: ref.relationTo,
      id: ref.id,
      overrideAccess: true
    }) as Record<string, unknown> | null;
    if (!target || !("seller" in target)) continue;
    if (idOf(target.seller) !== sellerId) {
      throw new Error(
        `跨 seller relationship 被拒绝：${collection.slug} -> ${ref.relationTo}:${ref.id}`
      );
    }
  }

  return result;
}
