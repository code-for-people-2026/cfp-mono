import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePayloadRuntimeEnvironment } from "./runtime-environment.mjs";

const productionEnvironment = {
  NODE_ENV: "production",
  PAYLOAD_SECRET: "production-secret",
  DATABASE_URL: "postgresql://payload@example.test/cfp",
};

const websiteRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("resolvePayloadRuntimeEnvironment", () => {
  it("requires PAYLOAD_SECRET in a production runtime", () => {
    expect(() =>
      resolvePayloadRuntimeEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: productionEnvironment.DATABASE_URL,
      }),
    ).toThrow("PAYLOAD_SECRET is required for production Payload runtimes.");
  });

  it("requires Postgres in a production runtime", () => {
    expect(() =>
      resolvePayloadRuntimeEnvironment({
        NODE_ENV: "production",
        PAYLOAD_SECRET: productionEnvironment.PAYLOAD_SECRET,
        DATABASE_URI: "file:./payload.db",
      }),
    ).toThrow("A Postgres database URL is required for production Payload runtimes.");

    expect(() =>
      resolvePayloadRuntimeEnvironment({
        NODE_ENV: "production",
        PAYLOAD_SECRET: productionEnvironment.PAYLOAD_SECRET,
        DATABASE_URL: "file:./payload.db",
      }),
    ).toThrow("A Postgres database URL is required for production Payload runtimes.");
  });

  it.each(["https://example.test/cfp", "postgres://", "postgresql://[::1"])(
    "rejects the invalid production database URL %s",
    (databaseURL) => {
      expect(() =>
        resolvePayloadRuntimeEnvironment({
          NODE_ENV: "production",
          PAYLOAD_SECRET: productionEnvironment.PAYLOAD_SECRET,
          DATABASE_URL: databaseURL,
        }),
      ).toThrow("A Postgres database URL is required for production Payload runtimes.");
    },
  );

  it("accepts the complete production contract", () => {
    expect(resolvePayloadRuntimeEnvironment(productionEnvironment)).toEqual({
      payloadSecret: productionEnvironment.PAYLOAD_SECRET,
      postgresDatabaseURL: productionEnvironment.DATABASE_URL,
    });
  });

  it("lets self-hosted image builds use disposable defaults", () => {
    expect(
      resolvePayloadRuntimeEnvironment({
        NODE_ENV: "production",
        CFP_WEBSITE_BUILD: "1",
      }),
    ).toEqual({
      payloadSecret: undefined,
      postgresDatabaseURL: undefined,
    });
  });

  it("does not let the build marker bypass the production start preflight", () => {
    const result = spawnSync(process.execPath, ["scripts/validate-production-env.mjs"], {
      cwd: websiteRoot,
      encoding: "utf8",
      env: {
        CFP_WEBSITE_BUILD: "1",
        NODE_ENV: "production",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "PAYLOAD_SECRET is required for production Payload runtimes.",
    );
  });

  it.each(["1", "true"])(
    "keeps the production contract active for Vercel=%s builds",
    (vercel) => {
      expect(() =>
        resolvePayloadRuntimeEnvironment({
          NODE_ENV: "production",
          CFP_WEBSITE_BUILD: "1",
          VERCEL: vercel,
        }),
      ).toThrow("PAYLOAD_SECRET is required for production Payload runtimes.");
    },
  );

  it("treats whitespace-only values as missing", () => {
    expect(() =>
      resolvePayloadRuntimeEnvironment({
        NODE_ENV: "production",
        PAYLOAD_SECRET: "  ",
        DATABASE_URL: "  ",
      }),
    ).toThrow("PAYLOAD_SECRET is required for production Payload runtimes.");
  });

  it("does not rewrite a non-blank Payload secret", () => {
    expect(
      resolvePayloadRuntimeEnvironment({
        PAYLOAD_SECRET: " secret with intentional spaces ",
      }).payloadSecret,
    ).toBe(" secret with intentional spaces ");
  });

  it.each([
    "PAYLOAD_DATABASE_URL",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL",
  ])("supports the %s Postgres variable", (name) => {
    const postgresURL = `postgresql://${name.toLowerCase()}@example.test/cfp`;

    expect(
      resolvePayloadRuntimeEnvironment({
        ...productionEnvironment,
        DATABASE_URL: undefined,
        [name]: postgresURL,
      }).postgresDatabaseURL,
    ).toBe(postgresURL);
  });

  it("accepts a Postgres DATABASE_URI and ignores a SQLite DATABASE_URI", () => {
    expect(
      resolvePayloadRuntimeEnvironment({
        DATABASE_URI: "postgres://payload@example.test/cfp",
      }).postgresDatabaseURL,
    ).toBe("postgres://payload@example.test/cfp");

    expect(
      resolvePayloadRuntimeEnvironment({
        DATABASE_URI: "file:./payload.db",
      }).postgresDatabaseURL,
    ).toBeUndefined();
  });
});
