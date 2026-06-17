import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3302";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1",
    cwd: ".",
    // Probe the seed endpoint: it returns 200 once the server is up AND the content has
    // been seeded into Payload, so tests run against populated data.
    url: `${baseURL}/api/seed`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PAYLOAD_SECRET: "e2e-payload-secret",
      DATABASE_URI: "file:./payload-cms-e2e.db",
      ALLOW_ADMIN_BOOTSTRAP: "true",
      PAYLOAD_SEED: "true",
    },
  },
});
