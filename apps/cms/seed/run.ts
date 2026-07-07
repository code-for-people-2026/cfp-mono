import { getPayload } from "payload";
import { applySeed, taoziFixture } from "@cfp/kith-inn-payload/seed";

/**
 * Seed 桃子's "灶台" (PRD §9 M0): one seller (经营画像: 4菜1汤 / 周一至五 / 午晚 /
 * 配送 deliverers=["奶奶"]) + her offering pool (component dishes tagged with
 * 主料 + 荤素). Idempotent — re-running skips if the seller already exists.
 *
 *   pnpm --filter @cfp/cms seed     # auto-loads apps/cms/.env (DATABASE_URI 等)
 */

// payload.config reads DATABASE_URI at module-load; load .env FIRST (native
// process.loadEnvFile, no new dep — mirrors apps/kith-inn-be/src/index.ts). A
// static `import config` would be hoisted above this call, so config is imported
// dynamically inside main(). Without this, `pnpm seed` writes to sqlite while
// be/cms read postgres — data "vanishes" (was the A4 gotcha).
try {
  process.loadEnvFile();
} catch {
  /* no .env in cwd — rely on runtime env */
}

async function main() {
  const { default: config } = await import("../payload.config");
  const payload = await getPayload({ config });
  try {
    // Cast: the real Payload's `find`/`create` carry rich overload signatures
    // (e.g. `where: Where`); applySeed only needs the narrow seed surface, so we
    // adapt it via the parameter type rather than coupling the package to Payload's
    // exact arg shapes.
    const result = await applySeed(
      payload as unknown as Parameters<typeof applySeed>[0],
      taoziFixture,
    );
    if (result.seeded) {
      // eslint-disable-next-line no-console
      console.log(`✓ seeded 桃子's seller + ${result.offeringCount} offerings (seller ${result.sellerId})`);
    } else {
      // eslint-disable-next-line no-console
      console.log("✓ already seeded (桃子's seller exists) — skipped");
    }
  } finally {
    await payload.destroy();
  }
  // Force exit — Payload's postgres pool keeps the event loop alive after destroy.
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("seed failed:", err);
  process.exit(1);
});
