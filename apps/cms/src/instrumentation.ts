/** Next waits for register before accepting requests, including standalone. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { assertCmsProductionEnv } = await import("./config/production");
  assertCmsProductionEnv();
}
