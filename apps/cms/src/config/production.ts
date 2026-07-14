type Env = Record<string, string | undefined>;

const PLACEHOLDER = /(change[-_ ]?me|replace[-_ ]?me|placeholder|example|test[-_ ]?secret|dev[-_ ]?secret)/i;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value || PLACEHOLDER.test(value)) throw new Error(`${name} is required and cannot be a placeholder`);
  return value;
}

/** Fail closed only at production runtime; local SQLite remains supported. */
export function assertCmsProductionEnv(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const databaseUrl = required(env, "PAYLOAD_DATABASE_URL");
  let databaseHost = "";
  try {
    databaseHost = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error("PAYLOAD_DATABASE_URL must use non-local PostgreSQL");
  }
  if (
    !/^postgres(?:ql)?:\/\//i.test(databaseUrl) ||
    databaseHost === "localhost" ||
    databaseHost === "[::1]" ||
    /^127\./.test(databaseHost)
  ) {
    throw new Error("PAYLOAD_DATABASE_URL must use non-local PostgreSQL");
  }
  required(env, "PAYLOAD_SECRET");
  required(env, "JWT_SECRET");
  required(env, "CMS_INTERNAL_TOKEN");
}
