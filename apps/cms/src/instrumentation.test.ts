import { describe, expect, it } from "vitest";
import { register } from "./instrumentation";

describe("CMS server instrumentation", () => {
  it("fails before a production Node server accepts traffic", () => {
    expect(() => register({ NODE_ENV: "production", NEXT_RUNTIME: "nodejs" })).toThrow("PAYLOAD_DATABASE_URL");
  });

  it.each([
    ["build", { NODE_ENV: "production", NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" }],
    ["non-node runtime", { NODE_ENV: "production", NEXT_RUNTIME: "edge" }],
  ])("does not apply the runtime gate to %s", (_label, env) => {
    expect(() => register(env)).not.toThrow();
  });
});
