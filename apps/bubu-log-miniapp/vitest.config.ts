import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    poolOptions: { threads: { singleThread: true } },
    coverage: { provider: "v8", include: ["src/model/**/*.ts", "src/api/client.ts", "src/api/session.ts", "src/api/identity-session.ts"] },
  },
});
