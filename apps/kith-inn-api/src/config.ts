export function resolveKithInnDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment.KITH_INN_DATABASE_URL?.trim();
  if (!value) throw new Error("KITH_INN_DATABASE_URL is required");
  try {
    const url = new URL(value);
    const overridesTarget = [...url.searchParams.keys()].some((key) => ["database", "dbname", "host", "hostaddr", "port", "user", "password"].includes(key.toLowerCase()));
    if (["postgres:", "postgresql:"].includes(url.protocol) && url.hostname && /^\/[^/]+$/.test(decodeURIComponent(url.pathname)) && !overridesTarget) {
      return value;
    }
  } catch { /* Report the configuration name, never the supplied credential. */ }
  throw new Error("KITH_INN_DATABASE_URL must be a PostgreSQL database URL");
}

export function resolveKithInnTestDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const value = resolveKithInnDatabaseUrl(environment);
  if (!decodeURIComponent(new URL(value).pathname).endsWith("_test")) {
    throw new Error("KITH_INN_DATABASE_URL must name a database ending in _test for tests");
  }
  return value;
}

export function loadKithInnRuntimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const port = environment.PORT?.trim() ? Number(environment.PORT) : 3305;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const release = environment.RELEASE_SHA?.trim();
  return {
    databaseUrl: resolveKithInnDatabaseUrl(environment),
    port,
    release: !release ? "development" : /^[0-9a-f]{7,64}$/i.test(release) ? release.slice(0, 12).toLowerCase() : "unknown",
    wechatAppId: required("KITH_INN_WECHAT_APP_ID"),
    wechatAppSecret: required("KITH_INN_WECHAT_APP_SECRET"),
    wechatOwnerOpenId: required("KITH_INN_WECHAT_OWNER_OPEN_ID")
  };
}
