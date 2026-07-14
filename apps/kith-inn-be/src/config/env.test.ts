import { describe, expect, it } from "vitest";
import { assertKithInnProductionEnv } from "./env";

const validProductionEnv = {
  NODE_ENV: "production",
  JWT_SECRET: "jwt-production-value",
  CMS_BASE_URL: "http://cms:3304",
  CMS_INTERNAL_TOKEN: "internal-production-value",
  WX_APPID: "wx1234567890",
  WX_SECRET: "wx-production-value",
  DEEPSEEK_API_KEY: "sk-production-value",
};

describe("assertKithInnProductionEnv", () => {
  it.each(["JWT_SECRET", "CMS_BASE_URL", "CMS_INTERNAL_TOKEN", "WX_APPID", "WX_SECRET", "DEEPSEEK_API_KEY"])(
    "rejects missing %s in production",
    (name) => expect(() => assertKithInnProductionEnv({ ...validProductionEnv, [name]: "" })).toThrow(name),
  );

  it.each([
    ["JWT_SECRET", "change-me"],
    ["CMS_BASE_URL", "http://cms.test"],
    ["CMS_BASE_URL", "http://cms:65536"],
    ["CMS_BASE_URL", "http://cms:99999"],
    ["CMS_BASE_URL", "ftp://cms:3304"],
    ["CMS_BASE_URL", "http://user:pass@cms:3304"],
    ["CMS_BASE_URL", "http://:pass@cms:3304"],
    ["CMS_BASE_URL", "http://localhost:3304"],
    ["CMS_BASE_URL", "http://localhost.:3304"],
    ["CMS_BASE_URL", "http://admin.localhost.:3304"],
    ["CMS_BASE_URL", "http://127.0.0.1:3304"],
    ["CMS_BASE_URL", "http://cms.local:3304"],
    ["CMS_BASE_URL", "http://cms.lan:3304"],
    ["CMS_BASE_URL", "http://router.home.arpa:3304"],
    ["CMS_BASE_URL", "http://invalid:3304"],
    ["CMS_BASE_URL", "http://example:3304"],
    ["CMS_BASE_URL", "http://test:3304"],
    ["CMS_BASE_URL", "http://cms:0"],
    ["CMS_BASE_URL", "http://cms:3304/api"],
    ["CMS_BASE_URL", "http://cms:3304?debug=1"],
    ["CMS_BASE_URL", "http://cms:3304#debug"],
    ["CMS_INTERNAL_TOKEN", "placeholder"],
    ["WX_APPID", "example-appid"],
    ["WX_SECRET", "test-secret"],
    ["DEEPSEEK_API_KEY", "dev-secret"],
    ["DEEPSEEK_BASE_URL", "http://api.deepseek.com"],
    ["DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"],
    ["DEEPSEEK_BASE_URL", "https://api.deepseek.com?debug=1"],
    ["DEEPSEEK_BASE_URL", "https://user@api.deepseek.com"],
    ["DEEPSEEK_BASE_URL", "https://deepseek.example"],
    ["DEEPSEEK_BASE_URL", "not-a-url"],
  ])("rejects invalid or placeholder %s", (name, value) => {
    expect(() => assertKithInnProductionEnv({ ...validProductionEnv, [name]: value })).toThrow(name);
  });

  it("accepts complete production config and leaves development partial", () => {
    expect(() => assertKithInnProductionEnv(validProductionEnv)).not.toThrow();
    expect(() =>
      assertKithInnProductionEnv({ ...validProductionEnv, DEEPSEEK_BASE_URL: "https://api.deepseek.com" }),
    ).not.toThrow();
    expect(() => assertKithInnProductionEnv({ NODE_ENV: "development" })).not.toThrow();
  });
});
