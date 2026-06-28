import { configDefaults, defineConfig } from "vitest/config";

// Coverage excludes src/index.ts (the @hono/node-server boot shim — orchestration,
// exercised by running the server, not unit logic). The 100% gate lands on the
// deterministic core: routes, the fetch-boundary libs (wx/cms/deepseek), JWT, and
// the auth middleware.
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
