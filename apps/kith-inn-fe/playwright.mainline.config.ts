import { defineConfig } from "@playwright/test";
import { mainlineServiceLog } from "./tests/e2e/fixtures/mainline";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54324/cfp";
const cms = "http://127.0.0.1:3306";
const be = "http://127.0.0.1:3311";
const llm = "http://127.0.0.1:3321";
const logged = (command: string, name: string) => {
  const path = JSON.stringify(mainlineServiceLog(name));
  return `: > ${path} && (${command}) >> ${path} 2>&1`;
};
const sharedEnv = {
  JWT_SECRET: "mainline-e2e-jwt-secret",
  CMS_INTERNAL_TOKEN: "mainline-e2e-internal-token",
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "mainline.spec.ts",
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/mainline",
  reporter: [["html", { outputFolder: "playwright-report/mainline", open: "never" }]],
  use: { baseURL: "http://127.0.0.1:10087", trace: "retain-on-failure" },
  webServer: [
    {
      command: logged(`${process.env.CI ? "" : "pnpm --dir ../.. db:up && "}pnpm --dir ../cms seed:kith-inn:reset:dev && pnpm --dir ../cms exec next dev -p 3306`, "cms"),
      url: `${cms}/api/health`, timeout: 180_000, reuseExistingServer: false,
      env: {
        ...sharedEnv,
        PAYLOAD_DATABASE_URL: databaseUrl,
        DATABASE_URL: databaseUrl,
        PAYLOAD_SECRET: "mainline-e2e-payload-secret",
        KITH_INN_ALLOW_DEV_SEED_RESET: "1",
      },
    },
    {
      command: logged("pnpm --dir ../kith-inn-be exec tsx ../kith-inn-fe/tests/e2e/fixtures/fixed-llm-server.ts", "fixed-llm"),
      url: `${llm}/health`, timeout: 30_000, reuseExistingServer: false,
      env: { FIXED_LLM_PORT: "3321", FIXED_LLM_LOG_PATH: mainlineServiceLog("fixed-llm-requests") },
    },
    {
      command: logged("pnpm --dir ../kith-inn-be dev", "be"),
      url: `${be}/`, timeout: 60_000, reuseExistingServer: false,
      env: {
        ...sharedEnv,
        CMS_BASE_URL: cms,
        BE_PORT: "3311",
        DEEPSEEK_API_KEY: "mainline-fixed-key",
        DEEPSEEK_BASE_URL: llm,
        DEEPSEEK_MODEL: "deepseek-chat",
      },
    },
    {
      command: logged("pnpm build:h5:dev && pnpm exec serve -s dist -l 10087", "h5"),
      url: "http://127.0.0.1:10087", timeout: 120_000, reuseExistingServer: false,
      env: { BE_BASE_URL: be },
    },
  ],
});
