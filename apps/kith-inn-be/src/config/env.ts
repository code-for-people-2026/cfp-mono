import { isIP } from "node:net";

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|test[-_ ]?secret|dev[-_ ]?secret)/i;
const RESERVED_HOST = /(?:\.invalid|\.example|\.test)$/i;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value || PLACEHOLDER.test(value)) throw new Error(`${name} is required and cannot be a placeholder`);
  return value;
}

function assertCmsOrigin(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CMS_BASE_URL must be an explicit HTTP(S) origin");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    Boolean(url.username || url.password) ||
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    isIP(hostname) !== 0 ||
    RESERVED_HOST.test(hostname) ||
    url.port === "0" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("CMS_BASE_URL must be an explicit HTTP(S) origin");
  }
}

/** Validate every production trust boundary before the Hono server starts. */
export function assertKithInnProductionEnv(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  required(env, "JWT_SECRET");
  const cmsBaseUrl = required(env, "CMS_BASE_URL");
  assertCmsOrigin(cmsBaseUrl);
  required(env, "CMS_INTERNAL_TOKEN");
  required(env, "WX_APPID");
  required(env, "WX_SECRET");
  required(env, "DEEPSEEK_API_KEY");
}
