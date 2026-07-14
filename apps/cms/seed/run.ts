import { pathToFileURL } from "node:url";
import type { BasePayload, PayloadRequest } from "payload";
import { commitTransaction, createLocalReq, getPayload, initTransaction, killTransaction } from "payload";
import type { SeedResult } from "@cfp/kith-inn-payload/seed";
import {
  applySeed as applyOldSeed,
  resetSeedData as resetOldSeedData,
  taoziFixture,
} from "@cfp/kith-inn-payload/seed";
import {
  applySeed as applyV1Seed,
  resetSeedData as resetV1SeedData,
} from "@cfp/kith-inn-v1-payload/seed";
import config from "../payload.config";

/**
 * Seed 桃子's "灶台" (PRD §9 M0): one seller (经营画像: 4菜1汤 / 周一至五 / 午晚 /
 * 配送 deliverers=["奶奶"]) + her offering pool (component dishes tagged with
 * 主料 + 荤素).
 *
 *   pnpm --filter @cfp/cms seed:kith-inn
 *   pnpm --filter @cfp/cms seed:kiv1
 *   KITH_INN_ALLOW_DEV_SEED_RESET=1 pnpm --filter @cfp/cms seed:kith-inn:reset:dev
 *   KITH_INN_ALLOW_DEV_SEED_RESET=1 pnpm --filter @cfp/cms seed:kiv1:reset:dev
 */
const RESET_ARG = "--reset-dev";
type Env = Record<string, string | undefined>;
export type SeedProject = "kith-inn" | "kiv1";
const OPENID_PLACEHOLDER = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|test[-_ ]?secret|dev[-_ ]?secret)/i;

function trueish(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

export function resolveTrialOpenid(env: Env = process.env): string {
  const configured = env.KITH_INN_TRIAL_OPENID?.trim();
  if (configured && configured !== "taozi-dev-openid" && !OPENID_PLACEHOLDER.test(configured)) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error("KITH_INN_TRIAL_OPENID is required and cannot be a placeholder");
  }
  return "taozi-dev-openid";
}

export async function withSeedTransaction<T>(payload: BasePayload, work: (req: PayloadRequest) => Promise<T>): Promise<T> {
  const req = await createLocalReq({}, payload);
  if (!await initTransaction(req)) throw new Error("database transactions unavailable");
  try {
    const result = await work(req);
    await commitTransaction(req);
    return result;
  } catch (error) {
    await killTransaction(req);
    throw error;
  }
}

export function formatKithInnSeedSummary(result: SeedResult): string {
  return JSON.stringify({
    project: "kith-inn",
    status: result.seeded ? "provisioned" : "reconciled",
    sellerId: result.sellerId,
    offeringCount: result.offeringCount,
  });
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

export function parseSeedProject(args: string[]): SeedProject {
  const project = args.find((arg) => !arg.startsWith("-"));
  if (project === "kith-inn" || project === "kiv1") return project;
  throw new Error("Seed project must be exactly one of: kith-inn, kiv1.");
}

export async function runProjectSeed(
  payload: unknown,
  project: SeedProject,
  resetDev: boolean,
  options: { operatorOpenid?: string; req?: PayloadRequest } = {},
) {
  if (project === "kith-inn") {
    const reset = resetDev
      ? await resetOldSeedData(payload as Parameters<typeof resetOldSeedData>[0])
      : null;
    const seed = await applyOldSeed(
      payload as Parameters<typeof applyOldSeed>[0],
      taoziFixture,
      options,
    );
    return { project: "kith-inn" as const, reset, seed };
  }

  const reset = resetDev
    ? await resetV1SeedData(payload as Parameters<typeof resetV1SeedData>[0])
    : null;
  const seed = await applyV1Seed(payload as Parameters<typeof applyV1Seed>[0]);
  return { project: "kiv1" as const, reset, seed };
}

async function main() {
  const project = parseSeedProject(process.argv.slice(2));
  const resetDev = process.argv.includes(RESET_ARG);
  if (resetDev) assertDevResetAllowed();
  const operatorOpenid = project === "kith-inn" ? resolveTrialOpenid() : undefined;
  const payload = await getPayload({ config });
  try {
    const result = project === "kith-inn" && !resetDev
      ? await withSeedTransaction(payload, (req) => runProjectSeed(payload, project, false, { operatorOpenid, req }))
      : await runProjectSeed(payload, project, resetDev, { operatorOpenid });
    if (result.reset) {
      console.log(`✓ reset ${project} local dev data (${Object.entries(result.reset.deleted).map(([k, v]) => `${k}:${v}`).join(", ")})`);
    }
    if (result.project === "kith-inn") {
      console.log(formatKithInnSeedSummary(result.seed));
    } else if (result.seed.seeded) {
      console.log(`✓ seeded kiv1 桃子 seller/operator (seller ${result.seed.sellerId})`);
    } else {
      console.log("✓ kiv1 seed skipped: 桃子 seller/operator already exist");
    }
  } finally {
    await payload.destroy();
  }
  // Force exit — Payload's postgres pool keeps the event loop alive after destroy.
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("seed failed: provisioning_failed; verify required env and database state");
    process.exit(1);
  });
}
