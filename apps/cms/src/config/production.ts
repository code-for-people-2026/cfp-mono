import { isIP } from "node:net";

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|test[-_ ]?secret|dev[-_ ]?secret)/i;
const NUMERIC_IPV4 = /^(?:0x[\da-f]+|\d+)(?:\.(?:0x[\da-f]+|\d+)){0,3}$/i;
const RESERVED_HOST = /(?:^|\.)(?:invalid|example|test|local|lan|home\.arpa)$/i;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value || PLACEHOLDER.test(value)) throw new Error(`${name} is required and cannot be a placeholder`);
  return value;
}

/** Fail closed only at production runtime; local SQLite remains supported. */
export function assertCmsProductionEnv(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const databaseUrl = required(env, "PAYLOAD_DATABASE_URL");
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error("PAYLOAD_DATABASE_URL must use non-local PostgreSQL");
  }
  const databaseHost = parsedDatabaseUrl.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    !["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol) ||
    !databaseHost ||
    databaseHost === "localhost" || databaseHost.endsWith(".localhost") ||
    isIP(databaseHost) !== 0 ||
    NUMERIC_IPV4.test(databaseHost) ||
    RESERVED_HOST.test(databaseHost) ||
    parsedDatabaseUrl.searchParams.has("host")
  ) {
    throw new Error("PAYLOAD_DATABASE_URL must use non-local PostgreSQL");
  }
  required(env, "PAYLOAD_SECRET");
  required(env, "JWT_SECRET");
  required(env, "CMS_INTERNAL_TOKEN");
}
