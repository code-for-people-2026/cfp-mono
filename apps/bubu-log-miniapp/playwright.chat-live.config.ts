import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/live-chat",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: { ...devices["iPhone 13"], browserName: "chromium", timezoneId: "Asia/Shanghai", baseURL: "http://127.0.0.1:4340", actionTimeout: 15_000, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm --dir ../bubu-log-service test:browser-server",
    url: "http://127.0.0.1:4340/__fixture/ready",
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
