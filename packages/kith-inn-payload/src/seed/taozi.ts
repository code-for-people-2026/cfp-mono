import fixture from "./fixtures/taozi.json";
import type { PayloadRequest } from "payload";

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
  }>;
  /** Combo meal 桃子 sells by the 份 (parentOfferings = the whole component pool). */
  combo?: { name: string; priceCents: number };
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
      seller: sellerId,
      active: true,
    },
  }));
}

/** Build the operator create-op (桃子, dev openid for H5 login). auth:true needs
 *  email+password (synthetic, unused — login is by openid, not email/password). */
export function buildOperatorOp(sellerId: string | number, wechatOpenid = "taozi-dev-openid"): SeedOp {
  return {
    collection: "operators",
    data: {
      wechatOpenid,
      email: "taozi@kith-inn.local",
      password: "taozi-dev-password",
      role: "owner",
      active: true,
      seller: sellerId,
    },
  };
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
    depth?: number;
    limit?: number;
    overrideAccess?: boolean;
    req?: PayloadRequest;
  }) => Promise<{ docs: Array<{ id: string | number; [key: string]: unknown }> }>;
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
    overrideAccess?: boolean;
    req?: PayloadRequest;
  }) => Promise<{ id: string | number }>;
  update: (args: {
    collection: string;
    id: string | number;
    data: Record<string, unknown>;
    overrideAccess?: boolean;
    req?: PayloadRequest;
  }) => Promise<{ id: string | number }>;
  delete?: (args: {
    collection: string;
    id: string | number;
    overrideAccess?: boolean;
  }) => Promise<unknown>;
};

export type SeedResult = {
  seeded: boolean;
  sellerId: string | number;
  offeringCount: number;
};

export type ApplySeedOptions = { operatorOpenid?: string; req?: PayloadRequest };

export type ResetSeedResult = {
  deleted: Record<string, number>;
};

export const RESET_COLLECTIONS = [
  "chat_messages",
  "fulfillments",
  "order_items",
  "orders",
  "menu_plans",
  "service_slots",
  "subscriptions",
  "customers",
  "offerings",
  "operators",
  "sellers",
] as const;

/** Delete all kith-inn business data in FK-safe order. Only the explicit local
 * dev reset command should call this before inserting the fixed fixture. */
export async function resetSeedData(payload: Required<Pick<SeedPayload, "find" | "delete">>): Promise<ResetSeedResult> {
  const deleted: Record<string, number> = {};
  for (const collection of RESET_COLLECTIONS) {
    const docs = await payload.find({ collection, where: {}, limit: 0, overrideAccess: true });
    deleted[collection] = docs.docs.length;
    for (const doc of docs.docs as Array<{ id: string | number }>) {
      await payload.delete({ collection, id: doc.id, overrideAccess: true });
    }
  }
  return { deleted };
}

/**
 * Idempotently converge 桃子's baseline by stable seller, offering, and operator
 * business keys. Existing partial rows are repaired instead of skipping.
 * Customers are NOT seeded — 桃子 creates them by ordering (接龙): existing matches
 * by name, new ones after she confirms (see be agent recordOrders/createCustomers).
 * `overrideAccess` throughout — seed is a trusted server-side script, not a
 * tenant request, so it bypasses access control.
 */
export async function applySeed(payload: SeedPayload, f: TaoziFixture, options: ApplySeedOptions = {}): Promise<SeedResult> {
  let created = false;
  const upsert = async (
    collection: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
    updateData = data,
    acceptsExisting?: (doc: { id: string | number; [key: string]: unknown }) => boolean,
  ) => {
    const existing = await payload.find({ collection, where, depth: 0, limit: 2, overrideAccess: true, req: options.req });
    if (existing.docs.length > 1) throw new Error(`ambiguous seed key in ${collection}`);
    if (existing.docs[0]) {
      if (acceptsExisting && !acceptsExisting(existing.docs[0])) throw new Error(`conflicting seed key in ${collection}`);
      return payload.update({ collection, id: existing.docs[0].id, data: updateData, overrideAccess: true, req: options.req });
    }
    created = true;
    return payload.create({ collection, data, overrideAccess: true, req: options.req });
  };

  const seller = await upsert("sellers", { name: { equals: f.seller.name } }, buildSellerOp(f).data);
  // Offering pool (components) — capture ids so the combo can reference them.
  const ops = buildOfferingOps(f, seller.id);
  const componentIds: Array<string | number> = [];
  for (const op of ops) {
    const offering = await upsert("offerings", { and: [
      { seller: { equals: seller.id } },
      { name: { equals: op.data.name } },
      { kind: { equals: "component" } },
    ] }, op.data);
    componentIds.push(offering.id);
  }
  // 桃子 sells one combo (4菜1汤 30元/份); parentOfferings = the whole component pool.
  if (f.combo) {
    await upsert("offerings", { and: [
      { seller: { equals: seller.id } },
      { name: { equals: f.combo.name } },
      { kind: { equals: "combo-meal" } },
    ] }, buildComboOp(f, seller.id, componentIds).data);
  }
  // Seed 桃子's operator (with dev wechatOpenid for H5 dev-login).
  const operator = buildOperatorOp(seller.id, options.operatorOpenid).data;
  const operatorUpdate = { ...operator };
  delete operatorUpdate.password;
  await upsert(
    "operators",
    { email: { equals: operator.email } },
    operator,
    operatorUpdate,
    (existing) => {
      const existingSeller = typeof existing.seller === "object" && existing.seller !== null
        ? (existing.seller as { id: unknown }).id
        : existing.seller;
      return String(existingSeller) === String(seller.id);
    },
  );
  return { seeded: created, sellerId: seller.id, offeringCount: ops.length };
}
