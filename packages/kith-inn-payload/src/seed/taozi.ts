import fixture from "./fixtures/taozi.json";

/** A single seed create-op: target collection + doc data. */
export type SeedOp = { collection: string; data: Record<string, unknown> };

/** The shape of the seed fixture (taozi.json). */
export type TaoziFixture = {
  seller: {
    name: string;
    defaultPriceCents?: number;
    enabledModules?: readonly string[];
    moduleSettings?: Record<string, unknown>;
  };
  offerings: ReadonlyArray<{
    name: string;
    mainIngredient?: string;
    category?: string;
    tags?: string[];
  }>;
};

/** The seeded fixture (桃子) — exported so apps/cms's seed CLI can import it. */
export const taoziFixture = fixture as unknown as TaoziFixture;

/** Build the seller create-op (status forced active). */
export function buildSellerOp(f: TaoziFixture): SeedOp {
  return {
    collection: "sellers",
    data: { ...f.seller, status: "active" },
  };
}

/** Build the offering-pool create-ops, all attributed to `sellerId` (kind=component). */
export function buildOfferingOps(f: TaoziFixture, sellerId: string | number): SeedOp[] {
  return f.offerings.map((o) => ({
    collection: "offerings",
    data: {
      name: o.name,
      kind: "component",
      mainIngredient: o.mainIngredient,
      category: o.category,
      tags: o.tags,
      seller: sellerId,
      active: true,
    },
  }));
}

/** Minimal Payload surface applySeed needs (keeps it mockable for unit tests). */
type SeedPayload = {
  find: (args: {
    collection: string;
    where: Record<string, unknown>;
    limit?: number;
    overrideAccess?: boolean;
  }) => Promise<{ docs: unknown[] }>;
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
    overrideAccess?: boolean;
  }) => Promise<{ id: string | number }>;
};

export type SeedResult = {
  seeded: boolean;
  sellerId?: string | number;
  offeringCount: number;
};

/**
 * Idempotent seed (PRD §9 M0): if a seller with this name already exists, skip
 * (already seeded). Otherwise create 桃子's seller + her offering pool.
 * `overrideAccess` throughout — seed is a trusted server-side script, not a
 * tenant request, so it bypasses access control (the seller has no operator
 * session at first-run time).
 */
export async function applySeed(payload: SeedPayload, f: TaoziFixture): Promise<SeedResult> {
  const existing = await payload.find({
    collection: "sellers",
    where: { name: { equals: f.seller.name } },
    limit: 1,
    overrideAccess: true,
  });
  if (existing.docs.length > 0) {
    return { seeded: false, offeringCount: 0 };
  }
  const seller = await payload.create({
    collection: "sellers",
    data: buildSellerOp(f).data,
    overrideAccess: true,
  });
  const ops = buildOfferingOps(f, seller.id);
  for (const op of ops) {
    await payload.create({ collection: op.collection, data: op.data, overrideAccess: true });
  }
  return { seeded: true, sellerId: seller.id, offeringCount: ops.length };
}
