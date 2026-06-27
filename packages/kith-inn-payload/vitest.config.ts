import { configDefaults, defineConfig } from "vitest/config";

// Coverage is scoped to the security-critical tenant-isolation logic (Tech Spec
// §3.1): the access factory, write-side stamp, and the pure helpers. Collection
// configs are declarative; they are exercised by the postgres coexistence test
// in apps/cms and by PR2's traversal assertion, not by line coverage here.
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
        "src/payload/lib/**/*.ts",
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
