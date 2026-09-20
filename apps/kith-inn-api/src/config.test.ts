import { describe, expect, it } from "vitest";
import { loadKithInnRuntimeConfig, resolveKithInnDatabaseUrl, resolveKithInnTestDatabaseUrl } from "./config";
import { createKithInnPool } from "./database";

const environment = {
  KITH_INN_DATABASE_URL: "postgresql://owner:secret@example.test/kith_inn_test",
  KITH_INN_WECHAT_APP_ID: "test-app-id",
  KITH_INN_WECHAT_APP_SECRET: "test-app-secret",
  KITH_INN_WECHAT_OWNER_OPEN_ID: "test-owner"
};

describe("kith-inn configuration", () => {
  it("uses dedicated credentials, port 3305 and a bounded release identifier", () => {
    expect(loadKithInnRuntimeConfig({ ...environment, DATABASE_URL: "ignored", RELEASE_SHA: "ABCDEF1234567890" })).toEqual({
      databaseUrl: environment.KITH_INN_DATABASE_URL, port: 3305, release: "abcdef123456",
      wechatAppId: "test-app-id", wechatAppSecret: "test-app-secret", wechatOwnerOpenId: "test-owner"
    });
    expect(loadKithInnRuntimeConfig(environment).release).toBe("development");
    expect(loadKithInnRuntimeConfig({ ...environment, RELEASE_SHA: "arbitrary secret" }).release).toBe("unknown");
  });

  it.each(Object.keys(environment))("requires %s without a generic fallback", (name) => {
    expect(() => loadKithInnRuntimeConfig({ ...environment, [name]: "", DATABASE_URL: environment.KITH_INN_DATABASE_URL })).toThrow(`${name} is required`);
  });

  it.each(["not-a-url:secret", "postgres://", "https://owner:secret@example.test/db", "postgresql://example.test/", "postgresql://example.test/a/b", "postgresql://example.test/%_test", "postgresql://example.test/safe_test?database=production", "postgresql://example.test/safe_test?host=production"])("rejects invalid database URLs without echoing credentials", (value) => {
    expect(() => resolveKithInnDatabaseUrl({ KITH_INN_DATABASE_URL: value })).toThrow("KITH_INN_DATABASE_URL must be a PostgreSQL database URL");
  });

  it.each(["0", "65536", "1.5", "no-port"])("rejects invalid ports", (PORT) => {
    expect(() => loadKithInnRuntimeConfig({ ...environment, PORT })).toThrow("PORT must be an integer between 1 and 65535");
  });

  it("requires an explicit test database before allowing persistence tests", () => {
    expect(resolveKithInnTestDatabaseUrl(environment)).toBe(environment.KITH_INN_DATABASE_URL);
    expect(() => resolveKithInnTestDatabaseUrl({ DATABASE_URL: environment.KITH_INN_DATABASE_URL })).toThrow("KITH_INN_DATABASE_URL is required");
    expect(() => resolveKithInnTestDatabaseUrl({ KITH_INN_DATABASE_URL: "postgresql://example.test/kith_inn" })).toThrow("ending in _test");
  });

  it("sets bounded connection and statement timeouts", async () => {
    const pool = createKithInnPool(environment, { statement_timeout: 2_000 });
    expect(pool.options).toMatchObject({ connectionTimeoutMillis: 5_000, statement_timeout: 2_000 });
    await pool.end();
  });
});
