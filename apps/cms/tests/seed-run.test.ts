import { describe, expect, it } from "vitest";
import { assertDevResetAllowed, configuredPostgresUrl } from "../seed/run";

const allow = { KITH_INN_ALLOW_DEV_SEED_RESET: "1" };

describe("configuredPostgresUrl", () => {
  it("mirrors Payload's Postgres URL fallback order", () => {
    expect(configuredPostgresUrl({
      DATABASE_URI: "postgresql://uri/db",
      POSTGRES_URL: "postgresql://postgres-url/db",
      POSTGRES_URL_NON_POOLING: "postgresql://non-pooling/db",
      DATABASE_URL_UNPOOLED: "postgresql://unpooled/db",
      DATABASE_URL: "postgresql://database-url/db",
      PAYLOAD_DATABASE_URL: "postgresql://payload/db",
    })).toBe("postgresql://payload/db");
  });

  it("ignores sqlite DATABASE_URI", () => {
    expect(configuredPostgresUrl({ DATABASE_URI: "file:./payload.db" })).toBeUndefined();
  });
});

describe("assertDevResetAllowed", () => {
  it("rejects a remote Postgres URL from fallback env names", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      POSTGRES_URL: "postgresql://user:pass@db.example.com/cfp",
    })).toThrow(/non-local database URL/);
  });

  it("allows an explicit local dev reset against local Postgres", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      POSTGRES_URL_NON_POOLING: "postgresql://postgres:postgres@127.0.0.1:54324/cfp",
    })).not.toThrow();
  });

  it("allows sqlite fallback when no Postgres URL is configured", () => {
    expect(() => assertDevResetAllowed({
      ...allow,
      DATABASE_URI: "file:./payload.db",
    })).not.toThrow();
  });
});
