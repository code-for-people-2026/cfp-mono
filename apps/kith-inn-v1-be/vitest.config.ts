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
        "src/app.ts",
        "src/routes/**/*.ts",
        "src/middleware/**/*.ts",
        "src/lib/**/*.ts",
        "src/domain/**/*.ts"
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
