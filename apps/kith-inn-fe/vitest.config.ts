import { configDefaults, defineConfig } from "vitest/config";

// FE 100% strategy (Tech Spec §6): logic/services/store are pure + unit-tested to
// 100%; pages/components are presentational, exercised by H5 e2e (weapp manual).
// Mirrors apps/community-cooking's scoping.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: [...configDefaults.exclude, "tests/e2e/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/services/**/*.ts", "src/store/**/*.ts", "src/logic/**/*.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
