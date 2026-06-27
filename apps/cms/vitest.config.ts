import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// apps/cms is a thin Payload host: its only test is the postgres schema-isolation
// probe (tests/spike-coexistence.test.ts), which boots the assembled Payload and
// is excluded from line coverage. The tenant-isolation logic that needs 100%
// coverage lives in @cfp/kith-inn-payload, not here — mirroring apps/website,
// this host ships no enforceable logic of its own.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
