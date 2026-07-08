import { getPayload } from "payload";
import { applySeed, resetSeedData, taoziFixture } from "@cfp/kith-inn-payload/seed";
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

function trueish(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function looksLocalDatabaseUrl(raw: string | undefined): boolean {
  if (!raw) return true; // Payload's sqlite fallback is local.
  try {
    const host = new URL(raw).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

function assertDevResetAllowed() {
  if (process.env.KITH_INN_ALLOW_DEV_SEED_RESET !== "1") {
    throw new Error("Refusing destructive seed reset unless KITH_INN_ALLOW_DEV_SEED_RESET=1.");
  }
  const envText = [process.env.NODE_ENV, process.env.APP_ENV, process.env.CFP_ENV, process.env.VERCEL_ENV]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/(^|\s)(prod|production|stage|staging|preview)(\s|$)/.test(envText) || trueish(process.env.VERCEL)) {
    throw new Error("Refusing destructive seed reset outside local dev.");
  }
  const dbUrl = process.env.PAYLOAD_DATABASE_URL || process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!looksLocalDatabaseUrl(dbUrl)) {
    throw new Error("Refusing destructive seed reset for a non-local database URL.");
  }
}

async function main() {
  const resetDev = process.argv.includes(RESET_ARG);
  if (resetDev) assertDevResetAllowed();
  const payload = await getPayload({ config });
  try {
    // Cast: the real Payload's `find`/`create` carry rich overload signatures
    // (e.g. `where: Where`); applySeed only needs the narrow seed surface, so we
    // adapt it via the parameter type rather than coupling the package to Payload's
    // exact arg shapes.
    const reset = resetDev ? await resetSeedData(payload as unknown as Parameters<typeof resetSeedData>[0]) : null;
    const result = await applySeed(
      payload as unknown as Parameters<typeof applySeed>[0],
      taoziFixture,
    );
    if (reset) console.log(`✓ reset local dev data (${Object.entries(reset.deleted).map(([k, v]) => `${k}:${v}`).join(", ")})`);
    if (result.seeded) console.log(`✓ seeded 桃子's seller + ${result.offeringCount} offerings (seller ${result.sellerId})`);
    else console.log("✓ seed skipped: 桃子 already exists; existing data left unchanged");
  } finally {
    await payload.destroy();
  }
  // Force exit — Payload's postgres pool keeps the event loop alive after destroy.
  process.exit(0);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
