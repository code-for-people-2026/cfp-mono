import { defineConfig } from "@playwright/test";

const reuseExistingServer = !process.env.CI;
const sharedEnv = {
  JWT_SECRET: "adaptive-swap-e2e-jwt-secret",
  CMS_INTERNAL_TOKEN: "adaptive-swap-e2e-internal-token",
};
const resetCmsDatabase = "node --input-type=module -e \"import{rmSync}from'node:fs';for(const suffix of ['','-shm','-wal'])rmSync('../cms/payload-adaptive-swap-e2e.db'+suffix,{force:true})\"";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "menu-swap.spec.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:10086",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `${resetCmsDatabase} && pnpm --dir ../cms seed:kith-inn && pnpm --dir ../cms exec next dev -p 3305`,
      url: "http://127.0.0.1:3305/api/health",
      reuseExistingServer,
      timeout: 120_000,
      env: {
        ...sharedEnv,
        PAYLOAD_DATABASE_URL: "",
        DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
        POSTGRES_URL_NON_POOLING: "",
        POSTGRES_URL: "",
        DATABASE_URI: "file:./payload-adaptive-swap-e2e.db",
        PAYLOAD_SECRET: "adaptive-swap-e2e-payload-secret",
      },
    },
    {
      command: "pnpm --dir ../kith-inn-be dev",
      url: "http://127.0.0.1:3310/",
      reuseExistingServer,
      timeout: 60_000,
      env: {
        ...sharedEnv,
        CMS_BASE_URL: "http://127.0.0.1:3305",
        BE_PORT: "3310",
      },
    },
    {
      command: "pnpm build:h5 && pnpm exec serve -s dist -l 10086",
      url: "http://127.0.0.1:10086",
      reuseExistingServer,
      timeout: 120_000,
      env: { BE_BASE_URL: "http://127.0.0.1:3310" },
    },
  ],
});
