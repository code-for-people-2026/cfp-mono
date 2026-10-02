import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { provider: "v8", include: ["src/chat/model.ts"] },
  },
});
