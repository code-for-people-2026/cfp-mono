import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3303";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: [["html", { outputFolder: "./playwright-report" }], ["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "pnpm build:h5 && pnpm exec serve dist -l 3303",
    cwd: ".",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI
  }
});
