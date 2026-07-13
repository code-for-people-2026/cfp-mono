export const TAOZI_SELLER_NAME = "桃子";
export const TAOZI_OPERATOR_OPENID = "taozi-v1-dev-openid";

export const RESET_COLLECTIONS = [
  "kiv1_orders",
  "kiv1_booking_batches",
  "kiv1_meal_slots",
  "kiv1_customer_profiles",
  "kiv1_offerings",
  "kiv1_operators",
  "kiv1_sellers"
] as const;

export function buildSellerData(): Record<string, unknown> {
  return {
    name: TAOZI_SELLER_NAME,
    defaultPriceCents: 3000,
    status: "active"
  };
}

export function buildOperatorData(sellerId: string | number): Record<string, unknown> {
  return {
    seller: sellerId,
    wechatOpenid: TAOZI_OPERATOR_OPENID,
    active: true
  };
}

type SeedPayload = {
  find: (args: {
    collection: string;
    where: Record<string, unknown>;
    limit: number;
    overrideAccess: boolean;
  }) => Promise<{ docs: Array<{ id: string | number }> }>;
  create: (args: {
    collection: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
  }) => Promise<{ id: string | number }>;
  delete?: (args: {
    collection: string;
    id: string | number;
    overrideAccess: boolean;
  }) => Promise<unknown>;
};

export type SeedResult = {
  seeded: boolean;
  sellerId: string | number;
  sellerCreated: boolean;
  operatorCreated: boolean;
};

export type ResetSeedResult = {
  deleted: Record<string, number>;
};

export async function resetSeedData(
  payload: Required<Pick<SeedPayload, "find" | "delete">>
): Promise<ResetSeedResult> {
  const deleted: Record<string, number> = {};
  for (const collection of RESET_COLLECTIONS) {
    const docs = await payload.find({
      collection,
      where: {},
      limit: 0,
      overrideAccess: true
    });
    deleted[collection] = docs.docs.length;
    for (const doc of docs.docs) {
      await payload.delete({ collection, id: doc.id, overrideAccess: true });
    }
  }
  return { deleted };
}

export async function applySeed(payload: SeedPayload): Promise<SeedResult> {
  const sellers = await payload.find({
    collection: "kiv1_sellers",
    where: { name: { equals: TAOZI_SELLER_NAME } },
    limit: 1,
    overrideAccess: true
  });
  const sellerCreated = sellers.docs.length === 0;
  const seller = sellerCreated
    ? await payload.create({
      collection: "kiv1_sellers",
      data: buildSellerData(),
      overrideAccess: true
    })
    : sellers.docs[0]!;

  const operators = await payload.find({
    collection: "kiv1_operators",
    where: {
      and: [
        { seller: { equals: seller.id } },
        { wechatOpenid: { equals: TAOZI_OPERATOR_OPENID } }
      ]
    },
    limit: 1,
    overrideAccess: true
  });
  const operatorCreated = operators.docs.length === 0;
  if (operatorCreated) {
    await payload.create({
      collection: "kiv1_operators",
      data: buildOperatorData(seller.id),
      overrideAccess: true
    });
  }

  return {
    seeded: sellerCreated || operatorCreated,
    sellerId: seller.id,
    sellerCreated,
    operatorCreated
  };
}
