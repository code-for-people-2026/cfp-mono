import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3300";
const databaseURL =
  process.env.PAYLOAD_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54324/cfp";

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
    command: "pnpm dev --hostname 127.0.0.1",
    cwd: ".",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: databaseURL,
      PAYLOAD_DATABASE_URL: databaseURL,
      PAYLOAD_SECRET: "site-e2e-secret",
      PAYLOAD_DB_PUSH: "true",
      ALLOW_ADMIN_BOOTSTRAP: "true",
      MINIAPP_H5_ORIGIN: "http://127.0.0.1:3301"
    }
  }
});

