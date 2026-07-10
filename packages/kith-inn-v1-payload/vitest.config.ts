import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/payload/access/**/*.ts",
        "src/payload/hooks/**/*.ts",
        "src/payload/collections/**/*.ts",
        "src/payload/index.ts",
        "src/seed/**/*.ts"
      ],
      exclude: ["src/seed/index.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
