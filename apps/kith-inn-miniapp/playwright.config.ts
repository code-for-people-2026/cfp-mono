import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT || "3316";
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["html", { outputFolder: "./playwright-report" }], ["list"]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
  webServer: {
    command: `TARO_APP_KITH_INN_API_BASE_URL=https://kith-inn.test pnpm build:h5 && pnpm exec serve -s -n dist -l tcp://127.0.0.1:${port}`,
    cwd: ".",
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI
  }
});
