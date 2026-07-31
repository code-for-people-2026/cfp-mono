import { resolveWeeklyMenuDatabaseUrl } from "./database";

export type WeeklyMenuRuntimeConfig = Readonly<{
  databaseUrl: string;
  port: number;
  recipesBaseUrl: string;
  release: string;
  wechatAppId: string;
  wechatAppSecret: string;
}>;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseRecipesBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("WEEKLY_MENU_RECIPES_BASE_URL must be an HTTP URL");
  }
  return url.toString();
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3304;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseRelease(value: string | undefined): string {
  const release = value?.trim();
  if (!release) return "development";
  if (!/^[0-9a-f]{7,64}$/i.test(release)) return "unknown";
  return release.slice(0, 12).toLowerCase();
}

export function loadWeeklyMenuRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env
): WeeklyMenuRuntimeConfig {
  return {
    databaseUrl: resolveWeeklyMenuDatabaseUrl(environment),
    port: parsePort(environment.PORT),
    recipesBaseUrl: parseRecipesBaseUrl(
      required(environment, "WEEKLY_MENU_RECIPES_BASE_URL")
    ),
    release: parseRelease(environment.RELEASE_SHA),
    wechatAppId: required(environment, "WEEKLY_MENU_WECHAT_APP_ID"),
    wechatAppSecret: required(environment, "WEEKLY_MENU_WECHAT_APP_SECRET")
  };
}
