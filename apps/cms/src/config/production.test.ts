import { describe, expect, it } from "vitest";
import { assertCmsProductionEnv } from "./production";

const validProductionEnv = {
  NODE_ENV: "production",
  PAYLOAD_DATABASE_URL: "postgres://cms:secret@postgres/cfp",
  PAYLOAD_SECRET: "payload-production-value",
  JWT_SECRET: "jwt-production-value",
  CMS_INTERNAL_TOKEN: "internal-production-value",
};

describe("assertCmsProductionEnv", () => {
  it.each(["PAYLOAD_DATABASE_URL", "PAYLOAD_SECRET", "JWT_SECRET", "CMS_INTERNAL_TOKEN"])(
    "rejects missing %s in production",
    (name) => expect(() => assertCmsProductionEnv({ ...validProductionEnv, [name]: "" })).toThrow(name),
  );

  it.each([
    ["PAYLOAD_DATABASE_URL", "file:./payload.db"],
    ["PAYLOAD_DATABASE_URL", "not-a-database-url"],
    ["PAYLOAD_DATABASE_URL", "postgres://postgres:postgres@localhost:54324/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@localhost.:5432/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@db.localhost.:5432/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@[::1]:5432/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@2130706433/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@0177.0.0.1/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@0x7f.0.0.1/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@[::ffff:127.0.0.1]/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres:///cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@rds.internal/cfp?host=/var/run/postgresql"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@db.test/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@invalid/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@db.local/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@db.lan/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:secret@router.home.arpa/cfp"],
    ["PAYLOAD_DATABASE_URL", "postgres://cms:change-me@rds.internal/cfp"],
    ["PAYLOAD_SECRET", "change-me"],
    ["JWT_SECRET", "test-secret"],
    ["CMS_INTERNAL_TOKEN", "placeholder"],
  ])("rejects invalid or placeholder %s", (name, value) => {
    expect(() => assertCmsProductionEnv({ ...validProductionEnv, [name]: value })).toThrow(name);
  });

  it("accepts complete production config and non-production SQLite", () => {
    expect(() => assertCmsProductionEnv(validProductionEnv)).not.toThrow();
    expect(() =>
      assertCmsProductionEnv({ NODE_ENV: "development", DATABASE_URI: "file:./payload.db" }),
    ).not.toThrow();
  });
});
