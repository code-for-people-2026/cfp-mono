import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    poolOptions: { threads: { singleThread: true } },
    coverage: { provider: "v8", include: ["src/model/**/*.ts", "src/api/client.ts", "src/api/session.ts", "src/api/identity-session.ts"] },
  },
});
