import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real renderer imports plus coverage contend with the other monorepo apps in CI.
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 15000,
    coverage: { provider: "v8", include: ["src/chat/model.ts"] },
  },
});
