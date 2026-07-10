import { pathToFileURL } from "node:url";
import { getPayload } from "payload";
import {
  applySeed as applyOldSeed,
  resetSeedData as resetOldSeedData,
  taoziFixture,
} from "@cfp/kith-inn-payload/seed";
import {
  applySeed as applyV1Seed,
  RESET_COLLECTIONS as V1_RESET_COLLECTIONS,
} from "@cfp/kith-inn-v1-payload/seed";
import config from "../payload.config";

/**
 * Seed 桃子's "灶台" (PRD §9 M0): one seller (经营画像: 4菜1汤 / 周一至五 / 午晚 /
 * 配送 deliverers=["奶奶"]) + her offering pool (component dishes tagged with
 * 主料 + 荤素).
 *
 *   pnpm --filter @cfp/cms seed
 *   KITH_INN_ALLOW_DEV_SEED_RESET=1 pnpm --filter @cfp/cms seed:reset:dev
 */
const RESET_ARG = "--reset-dev";
type Env = Record<string, string | undefined>;
type ResetPayload = {
  find: (args: {
    collection: string;
    where: Record<string, unknown>;
    limit: number;
    overrideAccess: boolean;
  }) => Promise<{ docs: Array<{ id: string | number }> }>;
  delete: (args: {
    collection: string;
    id: string | number;
    overrideAccess: boolean;
  }) => Promise<unknown>;
};

function trueish(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function configuredPostgresUrl(env: Env = process.env): string | undefined {
  return env.PAYLOAD_DATABASE_URL ||
    env.DATABASE_URL ||
    env.DATABASE_URL_UNPOOLED ||
    env.POSTGRES_URL_NON_POOLING ||
    env.POSTGRES_URL ||
    (env.DATABASE_URI?.startsWith("postgres") ? env.DATABASE_URI : undefined);
}

export function looksLocalDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return true; // Payload's sqlite fallback is local.
  try {
    const host = new URL(raw).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

export function assertDevResetAllowed(env: Env = process.env) {
  if (env.KITH_INN_ALLOW_DEV_SEED_RESET !== "1") {
    throw new Error("Refusing destructive seed reset unless KITH_INN_ALLOW_DEV_SEED_RESET=1.");
  }
  const envText = [env.NODE_ENV, env.APP_ENV, env.CFP_ENV, env.VERCEL_ENV]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(^|\s)(prod|production|stage|staging|preview)(\s|$)/.test(envText) || trueish(env.VERCEL)) {
    throw new Error("Refusing destructive seed reset outside local dev.");
  }
  if (!looksLocalDatabaseUrl(configuredPostgresUrl(env))) {
    throw new Error("Refusing destructive seed reset for a non-local database URL.");
  }
}

export async function applyAllSeeds(payload: unknown) {
  const old = await applyOldSeed(
    payload as Parameters<typeof applyOldSeed>[0],
    taoziFixture,
  );
  const v1 = await applyV1Seed(payload as Parameters<typeof applyV1Seed>[0]);
  return { old, v1 };
}

export async function resetAllSeedData(payload: ResetPayload) {
  const old = await resetOldSeedData(
    payload as Parameters<typeof resetOldSeedData>[0],
  );
  const deleted: Record<string, number> = {};
  for (const collection of V1_RESET_COLLECTIONS) {
    const docs = await payload.find({
      collection,
      where: {},
      limit: 0,
      overrideAccess: true,
    });
    deleted[collection] = docs.docs.length;
    for (const doc of docs.docs) {
      await payload.delete({
        collection,
        id: doc.id,
        overrideAccess: true,
      });
    }
  }
  return { old, v1: { deleted } };
}

async function main() {
  const resetDev = process.argv.includes(RESET_ARG);
  if (resetDev) assertDevResetAllowed();
  const payload = await getPayload({ config });
  try {
    const reset = resetDev
      ? await resetAllSeedData(payload as unknown as ResetPayload)
      : null;
    const result = await applyAllSeeds(payload);
    if (reset) {
      const deleted = { ...reset.old.deleted, ...reset.v1.deleted };
      console.log(`✓ reset local dev data (${Object.entries(deleted).map(([k, v]) => `${k}:${v}`).join(", ")})`);
    }
    if (result.old.seeded) console.log(`✓ seeded 桃子's seller + ${result.old.offeringCount} offerings (seller ${result.old.sellerId})`);
    else console.log("✓ seed skipped: 桃子 already exists; existing data left unchanged");
    if (result.v1.seeded) console.log(`✓ seeded v1 桃子 seller/operator (seller ${result.v1.sellerId})`);
    else console.log("✓ v1 seed skipped: 桃子 seller/operator already exist");
  } finally {
    await payload.destroy();
  }
  // Force exit — Payload's postgres pool keeps the event loop alive after destroy.
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("seed failed:", err);
    process.exit(1);
  });
}
