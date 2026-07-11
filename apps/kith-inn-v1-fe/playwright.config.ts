import { defineConfig } from "@playwright/test";

const reuseExistingServer = !process.env.CI;
const sharedEnv = {
  KITH_INN_V1_JWT_SECRET: "m1-b-e2e-jwt-secret",
  KITH_INN_V1_INTERNAL_TOKEN: "m1-b-e2e-internal-token"
};
const resetCmsDatabase = "node --input-type=module -e \"import{rmSync}from'node:fs';for(const suffix of ['','-shm','-wal'])rmSync('../cms/payload-m1-b-e2e.db'+suffix,{force:true})\"";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:10087",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `${resetCmsDatabase} && pnpm --dir ../cms seed && pnpm --dir ../cms dev`,
      url: "http://127.0.0.1:3304/api/health",
      reuseExistingServer,
      timeout: 120_000,
      env: {
        ...sharedEnv,
        PAYLOAD_DATABASE_URL: "",
        DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
        POSTGRES_URL_NON_POOLING: "",
        POSTGRES_URL: "",
        DATABASE_URI: "file:./payload-m1-b-e2e.db",
        PAYLOAD_SECRET: "m1-b-e2e-payload-secret"
      }
    },
    {
      command: "pnpm --dir ../kith-inn-v1-be dev",
      url: "http://127.0.0.1:3311/health",
      reuseExistingServer,
      timeout: 60_000,
      env: {
        ...sharedEnv,
        CMS_BASE_URL: "http://127.0.0.1:3304",
        KITH_INN_V1_ALLOW_DEV_LOGIN: "1",
        BE_PORT: "3311"
      }
    },
    {
      command: "pnpm dev:h5",
      url: "http://127.0.0.1:10087",
      reuseExistingServer,
      timeout: 120_000,
      env: {
        BE_BASE_URL: "http://127.0.0.1:3311",
        KITH_INN_V1_CUSTOMER_DEV_OPENID: "e2e-customer-openid"
      }
    }
  ]
});
