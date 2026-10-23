import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  use: { ...devices["iPhone 13"], browserName: "chromium", baseURL: "http://127.0.0.1:4338", trace: "retain-on-failure" },
  webServer: { command: "pnpm exec vite preview --outDir dist/h5 --host 127.0.0.1 --port 4338 --strictPort", url: "http://127.0.0.1:4338", reuseExistingServer: !process.env.CI },
});
