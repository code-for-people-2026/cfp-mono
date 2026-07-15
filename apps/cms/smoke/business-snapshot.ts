import { createHash } from "node:crypto";
import { collections } from "@cfp/kith-inn-payload";

export type SnapshotClient = {
  find: (args: {
    collection: string;
    where: Record<string, unknown>;
    depth: number;
    limit: number;
    overrideAccess: boolean;
  }) => Promise<{ docs: unknown[] }>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : 1).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Hash every old kith-inn business record for one seller without emitting row data. */
export async function createBusinessSnapshot(client: SnapshotClient, rawSellerId: string) {
  const sellerId = rawSellerId.trim();
  if (!sellerId) throw new Error("seller id is required");
  const scopedSellerId = /^\d+$/.test(sellerId) ? Number(sellerId) : sellerId;
  const rows = await Promise.all(collections.map(async ({ slug }) => {
    const result = await client.find({
      collection: slug,
      where: slug === "sellers"
        ? { id: { equals: scopedSellerId } }
        : { seller: { equals: scopedSellerId } },
      depth: 0,
      limit: 0,
      overrideAccess: true,
    });
    return [slug, result.docs.map((doc) => JSON.stringify(canonical(doc))).sort()] as const;
  }));
  rows.sort(([left], [right]) => left < right ? -1 : 1);
  const counts = Object.fromEntries(rows.map(([slug, docs]) => [slug, docs.length]));
  return {
    schemaVersion: 1,
    sellerId,
    counts,
    recordCount: rows.reduce((total, [, docs]) => total + docs.length, 0),
    digest: `sha256:${createHash("sha256").update(JSON.stringify(rows)).digest("hex")}`,
  };
}
