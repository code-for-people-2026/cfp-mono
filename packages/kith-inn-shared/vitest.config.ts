import { configDefaults, defineConfig } from "vitest/config";

// Pure domain kernel: enums + types. The runtime surface is just the `as const`
// enum tuples (covered on import); interfaces have no statements. Coverage is
// scoped to the source files so the 100% gate lands on real logic.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/enums.ts", "src/types.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
