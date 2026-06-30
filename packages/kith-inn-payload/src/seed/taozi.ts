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
  /** Combo meal 桃子 sells by the 份 (parentOfferings = the whole component pool). */
  combo?: { name: string; priceCents: number };
  /** Real customers + their default address (building/unit). `kind:"self"` = 桃子自家. */
  customers?: ReadonlyArray<{ displayName: string; kind?: string; note?: string; building?: string; unit?: string }>;
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

/** Build the operator create-op (桃子, dev openid for H5 login). auth:true needs
 *  email+password (synthetic, unused — login is by openid, not email/password). */
export function buildOperatorOp(sellerId: string | number): SeedOp {
  return {
    collection: "operators",
    data: {
      wechatOpenid: "taozi-dev-openid",
      email: "taozi@kith-inn.local",
      password: "taozi-dev-password",
      role: "owner",
      active: true,
      seller: sellerId,
    },
  };
}

/** Build customer create-ops (one per fixture customer). `defaultAddress` is
 *  linked inside applySeed after the address row exists (it needs the id). */
export function buildCustomerOps(f: TaoziFixture, sellerId: string | number): SeedOp[] {
  return (f.customers ?? []).map((c) => ({
    collection: "customers",
    data: { displayName: c.displayName, kind: c.kind ?? "regular", note: c.note, seller: sellerId },
  }));
}

/** Build one customer-address create-op for a customer's default address. */
export function buildAddressOp(
  sellerId: string | number,
  customerId: string | number,
  addr: { building: string; unit?: string },
): SeedOp {
  return { collection: "customer_addresses", data: { customer: customerId, building: addr.building, unit: addr.unit, seller: sellerId } };
}

/** Build the combo offering op — kind=combo-meal, parentOfferings = the component pool. */
export function buildComboOp(f: TaoziFixture, sellerId: string | number, componentIds: Array<string | number>): SeedOp {
  return {
    collection: "offerings",
    data: {
      name: f.combo!.name,
      kind: "combo-meal",
      priceCents: f.combo!.priceCents,
      parentOfferings: componentIds,
      seller: sellerId,
      active: true,
    },
  };
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
  update: (args: {
    collection: string;
    id: string | number;
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
  // Offering pool (components) — capture ids so the combo can reference them.
  const ops = buildOfferingOps(f, seller.id);
  const componentIds: Array<string | number> = [];
  for (const op of ops) {
    const created = await payload.create({ collection: op.collection, data: op.data, overrideAccess: true });
    componentIds.push(created.id);
  }
  // 桃子 sells one combo (4菜1汤 30元/份); parentOfferings = the whole component pool.
  if (f.combo) {
    await payload.create({ collection: "offerings", data: buildComboOp(f, seller.id, componentIds).data, overrideAccess: true });
  }
  // Seed 桃子's operator (with dev wechatOpenid for H5 dev-login).
  await payload.create({
    collection: "operators",
    data: buildOperatorOp(seller.id).data,
    overrideAccess: true,
  });
  // Customers + their default address. The address is linked after both rows
  // exist (it needs the ids) so fulfillments auto-bring the address at confirm
  // time. 桃子自家 (kind=self, no building) gets no address/self-fulfillment.
  const customerOps = buildCustomerOps(f, seller.id);
  const fixtureCustomers = f.customers ?? [];
  for (let i = 0; i < fixtureCustomers.length; i++) {
    const c = fixtureCustomers[i]!;
    const customer = await payload.create({ collection: customerOps[i]!.collection, data: customerOps[i]!.data, overrideAccess: true });
    if (c.building) {
      const addr = await payload.create({
        collection: "customer_addresses",
        data: buildAddressOp(seller.id, customer.id, { building: c.building, unit: c.unit }).data,
        overrideAccess: true,
      });
      await payload.update({ collection: "customers", id: customer.id, data: { defaultAddress: addr.id }, overrideAccess: true });
    }
  }
  return { seeded: true, sellerId: seller.id, offeringCount: ops.length };
}
