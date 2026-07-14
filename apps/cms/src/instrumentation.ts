import { assertCmsProductionEnv } from "./config/production";

/** Next waits for register before accepting requests, including standalone. */
export function register(env: Record<string, string | undefined> = process.env): void {
  if (env.NEXT_RUNTIME !== "nodejs" || env.NEXT_PHASE === "phase-production-build") return;
  assertCmsProductionEnv(env);
}
