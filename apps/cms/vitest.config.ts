import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// CMS combines real-Postgres integration suites with a colocated route boundary
// regression. Payload schema initialization must remain serialized across them.
export default defineConfig({
  test: {
    environment: "node",
    // Real-Postgres suites boot the same Payload schema; drizzle push must not
    // race another file's onInit/index reconciliation.
    fileParallelism: false,
    include: ["tests/**/*.test.ts", "src/app/api/internal/orders/[id]/route.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@payload-config": fileURLToPath(new URL("./payload.config.ts", import.meta.url)),
    },
  },
});
