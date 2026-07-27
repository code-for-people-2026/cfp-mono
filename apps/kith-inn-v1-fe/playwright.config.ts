import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const reuseExistingServer = !process.env.CI;
const sharedEnv = {
  KITH_INN_V1_JWT_SECRET: "m1-b-e2e-jwt-secret",
  KITH_INN_V1_INTERNAL_TOKEN: "m1-b-e2e-internal-token"
};
const cmsDatabaseUri = pathToFileURL(join(tmpdir(), "cfp-cms-kith-inn-v1-e2e.db")).href;
const resetCmsDatabase = "node --input-type=module -e \"import{rmSync}from'node:fs';import{fileURLToPath}from'node:url';const p=fileURLToPath(process.env.DATABASE_URI);for(const suffix of ['','-shm','-wal'])rmSync(p+suffix,{force:true})\"";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      pathTemplate: "../../specs/021-kith-inn-v1-booking-availability-sharing/evidence/{arg}{ext}",
      animations: "disabled",
      maxDiffPixelRatio: 0.05
    }
  },
  use: {
    baseURL: "http://127.0.0.1:10087",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: `${resetCmsDatabase} && pnpm --dir ../cms seed:kiv1 && pnpm --dir ../cms dev`,
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
        DATABASE_URI: cmsDatabaseUri,
        CFP_CMS_E2E_DIST_DIR: ".next-kith-inn-v1-e2e",
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
        KITH_INN_V1_CUSTOMER_DEV_OPENID: "e2e-customer-openid",
        KITH_INN_V1_ENABLE_JIELONG_IMPORT: "1"
      }
    }
  ]
});
