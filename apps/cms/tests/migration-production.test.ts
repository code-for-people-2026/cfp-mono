import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@payloadcms/db-postgres";
import { getPayload, type Payload } from "payload";
import config from "../payload.config";
import { configuredPostgresUrl } from "../seed/run";
import {
  assertCmsMigrationHead,
  assertProductionMigrationCommand,
  CMS_MIGRATION_HEAD,
} from "../src/db/migrationHead";

const execFile = promisify(execFileCallback);
const databaseUrl = configuredPostgresUrl();
const cmsDir = new URL("..", import.meta.url);

async function runMigrations(): Promise<void> {
  await execFile("pnpm", ["payload:migrate"], {
    cwd: cmsDir,
    env: { ...process.env, NODE_ENV: "test", PAYLOAD_DATABASE_URL: databaseUrl },
    timeout: 60_000,
  });
}

describe("production migration contract", () => {
  it("keeps dev push local and exposes only the non-destructive production migrate entry", () => {
    const source = readFileSync(new URL("../payload.config.ts", import.meta.url), "utf8");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(source).toContain('push: process.env.NODE_ENV !== "production"');
    expect(source).not.toContain("prodMigrations");
    expect(pkg.scripts["migrate:production"]).toBe("payload migrate");
    expect(Object.keys(pkg.scripts).filter((name) => /migrate:(fresh|reset|refresh)/.test(name))).toEqual([]);
  });

  it("commits exactly the declared baseline head", () => {
    const migrations = readdirSync(new URL("../migrations", import.meta.url)).filter((name) => name.endsWith(".ts") && name !== "index.ts");
    expect(migrations).toEqual([`${CMS_MIGRATION_HEAD}.ts`]);
  });

  it.each(["migrate:fresh", "migrate:reset", "migrate:refresh"])(
    "rejects %s before Payload can run it in production",
    (command) => {
      expect(() => assertProductionMigrationCommand("production", ["node", "payload", command])).toThrow(
        /disabled in production/,
      );
      expect(() => assertProductionMigrationCommand("development", ["node", "payload", command])).not.toThrow();
    },
  );
});

describe.skipIf(!databaseUrl)("PostgreSQL migration lifecycle", () => {
  let payload: Payload;
  const originalMigrating = process.env.PAYLOAD_MIGRATING;

  beforeAll(async () => {
    const setup = await getPayload({ config, key: "migration-production-setup" });
    await setup.db.execute({ drizzle: setup.db.drizzle, sql: sql`DROP SCHEMA IF EXISTS "cms" CASCADE` });
    await setup.destroy();
    await runMigrations();
    process.env.PAYLOAD_MIGRATING = "true";
    payload = await getPayload({ config, key: "migration-production-check" });
  }, 90_000);

  afterAll(async () => {
    if (payload) await payload.destroy();
    if (originalMigrating === undefined) delete process.env.PAYLOAD_MIGRATING;
    else process.env.PAYLOAD_MIGRATING = originalMigrating;
  });

  it("builds a fresh cms schema at the committed head", async () => {
    await expect(assertCmsMigrationHead(payload)).resolves.toBeUndefined();
    const result = await payload.db.execute({
      drizzle: payload.db.drizzle,
      sql: sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'cms'`,
    });
    expect((result.rows as Array<{ table_name: string }>).map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining(["sellers", "operators", "offerings", "kiv1_sellers", "payload_migrations"]),
    );
  });

  it("is a no-op on repeat and preserves existing v1 data", async () => {
    const sentinel = await payload.create({
      collection: "kiv1_sellers",
      data: { name: `migration-sentinel-${crypto.randomUUID()}`, status: "active" },
      overrideAccess: true,
    });
    await runMigrations();
    await expect(payload.findByID({ collection: "kiv1_sellers", id: sentinel.id, overrideAccess: true })).resolves.toMatchObject({
      id: sentinel.id,
      name: sentinel.name,
    });
  });

  it("rejects a database whose applied head does not match", async () => {
    await payload.db.execute({
      drizzle: payload.db.drizzle,
      sql: sql`UPDATE "cms"."payload_migrations" SET "name" = 'unexpected-head' WHERE "name" = ${CMS_MIGRATION_HEAD}`,
    });
    try {
      await expect(assertCmsMigrationHead(payload)).rejects.toThrow(/migration head/);
    } finally {
      await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`UPDATE "cms"."payload_migrations" SET "name" = ${CMS_MIGRATION_HEAD} WHERE "name" = 'unexpected-head'`,
      });
    }
  });
});
