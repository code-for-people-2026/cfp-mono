import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

describe("CMS server instrumentation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails before a production Node server accepts traffic", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await expect(register()).rejects.toThrow("PAYLOAD_DATABASE_URL");
  });

  it.each([
    ["build", { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" }],
    ["non-node runtime", { NODE_ENV: "production", NEXT_RUNTIME: "edge" }],
  ])("does not apply the runtime gate to %s", async (_label, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    await expect(register()).resolves.toBeUndefined();
  });
});
