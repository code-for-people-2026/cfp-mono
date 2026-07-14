type Env = Record<string, string | undefined>;

const PLACEHOLDER = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|test[-_ ]?secret|dev[-_ ]?secret)/i;
const CMS_ORIGIN = /^https?:\/\/(?![^/]*@)(?!localhost(?::|\/|$))(?!\d{1,3}(?:\.\d{1,3}){3}(?::|\/|$))(?![^/]*\.(?:invalid|example|test)(?::|\/|$))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[1-9]\d{0,4})?\/?$/i;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value || PLACEHOLDER.test(value)) throw new Error(`${name} is required and cannot be a placeholder`);
  return value;
}

/** Validate every production trust boundary before the Hono server starts. */
export function assertKithInnProductionEnv(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  required(env, "JWT_SECRET");
  const cmsBaseUrl = required(env, "CMS_BASE_URL");
  if (!CMS_ORIGIN.test(cmsBaseUrl)) throw new Error("CMS_BASE_URL must be an explicit HTTP(S) origin");
  required(env, "CMS_INTERNAL_TOKEN");
  required(env, "WX_APPID");
  required(env, "WX_SECRET");
  required(env, "DEEPSEEK_API_KEY");
}
