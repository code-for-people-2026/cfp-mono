import { describe, expect, it } from "vitest";
import { loadWeeklyMenuRuntimeConfig } from "./config";

const minimumEnvironment = {
  WEEKLY_MENU_DATABASE_URL: "postgresql://weekly@example.test/weekly_menu",
  WEEKLY_MENU_RECIPES_BASE_URL: "https://website.example.test/root",
  WEEKLY_MENU_WECHAT_APP_ID: "test-app-id",
  WEEKLY_MENU_WECHAT_APP_SECRET: "test-app-secret"
};

describe("loadWeeklyMenuRuntimeConfig", () => {
  it("uses the dedicated variables, default port and a short release", () => {
    expect(
      loadWeeklyMenuRuntimeConfig({
        ...minimumEnvironment,
        DATABASE_URL: "postgresql://website@example.test/website",
        RELEASE_SHA: "1234567890abcdef",
        UNRELATED_SECRET: "must-not-be-read"
      })
    ).toEqual({
      databaseUrl: minimumEnvironment.WEEKLY_MENU_DATABASE_URL,
      recipesBaseUrl: "https://website.example.test/root",
      wechatAppId: "test-app-id",
      wechatAppSecret: "test-app-secret",
      port: 3304,
      release: "1234567890ab"
    });
  });

  it.each([
    ["WEEKLY_MENU_RECIPES_BASE_URL", ""],
    ["WEEKLY_MENU_WECHAT_APP_ID", ""],
    ["WEEKLY_MENU_WECHAT_APP_SECRET", ""],
    ["PORT", "0"],
    ["PORT", "not-a-port"]
  ])("rejects invalid %s", (name, value) => {
    expect(() =>
      loadWeeklyMenuRuntimeConfig({ ...minimumEnvironment, [name]: value })
    ).toThrow();
  });

  it.each([
    [undefined, "development"],
    ["", "development"],
    ["not-a-git-sha", "unknown"],
    ["123456", "unknown"],
    ["ABCDEF1234567890", "abcdef123456"]
  ])("normalizes RELEASE_SHA %s without reflecting arbitrary values", (value, expected) => {
    expect(
      loadWeeklyMenuRuntimeConfig({
        ...minimumEnvironment,
        RELEASE_SHA: value
      }).release
    ).toBe(expected);
  });
});
