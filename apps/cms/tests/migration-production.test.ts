import { execFile as execFileCallback } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { sql } from "@payloadcms/db-postgres";
import { getPayload, type Payload } from "payload";
import { down } from "../migrations/20260714_110001_kith_inn_trial_baseline";
import config from "../payload.config";
import { configuredPostgresUrl } from "../seed/run";
import { CMS_BASELINE_TABLES, shouldAdoptCmsBaseline } from "../src/db/migrationBaseline";
import {
  assertCmsMigrationHead,
  assertProductionMigrationCommand,
  CMS_MIGRATION_HEAD,
  shouldRequireCmsMigrationHead,
} from "../src/db/migrationHead";

const execFile = promisify(execFileCallback);
const databaseUrl = configuredPostgresUrl();
const cmsDir = new URL("..", import.meta.url);
const lifecycleEnabled = Boolean(databaseUrl && process.env.CMS_MIGRATION_TEST_DISPOSABLE === "1");

async function runMigrations(): Promise<void> {
  await execFile("pnpm", ["migrate:production"], {
    cwd: cmsDir,
    env: { ...process.env, NODE_ENV: "test", PAYLOAD_DATABASE_URL: databaseUrl },
    timeout: 60_000,
  });
}

async function dropCmsSchema(key: string): Promise<void> {
  const setup = await getPayload({ config, key });
  try {
    await setup.db.execute({ drizzle: setup.db.drizzle, sql: sql`DROP SCHEMA IF EXISTS "cms" CASCADE` });
  } finally {
    await setup.destroy();
  }
}

async function withMigratingPayload<T>(key: string, operation: (payload: Payload) => Promise<T>): Promise<T> {
  const originalMigrating = process.env.PAYLOAD_MIGRATING;
  process.env.PAYLOAD_MIGRATING = "true";
  const payload = await getPayload({ config, key });
  try {
    return await operation(payload);
  } finally {
    await payload.destroy();
    if (originalMigrating === undefined) delete process.env.PAYLOAD_MIGRATING;
    else process.env.PAYLOAD_MIGRATING = originalMigrating;
  }
}

describe("production migration contract", () => {
  it("keeps dev push local and exposes only the non-destructive production migrate entry", () => {
    const source = readFileSync(new URL("../payload.config.ts", import.meta.url), "utf8");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(source).toContain('push: process.env.NODE_ENV !== "production"');
    expect(source).toContain('migrationDir: resolve(process.cwd(), "migrations")');
    expect(source).not.toContain("fileURLToPath");
    expect(source).not.toContain("prodMigrations");
    expect(pkg.scripts["migrate:production"]).toBe("tsx src/db/runProductionMigrations.ts");
    expect(Object.keys(pkg.scripts).filter((name) => /migrate:(fresh|reset|refresh)/.test(name))).toEqual([]);
  });

  it("commits exactly the declared baseline head", () => {
    const migrations = readdirSync(new URL("../migrations", import.meta.url)).filter((name) => name.endsWith(".ts") && name !== "index.ts");
    expect(migrations).toEqual([`${CMS_MIGRATION_HEAD}.ts`]);
  });

  it.each(["migrate:down", "migrate:fresh", "migrate:reset", "migrate:refresh"])(
    "rejects %s before Payload can run it in production",
    (command) => {
      expect(() => assertProductionMigrationCommand("production", ["node", "payload", command])).toThrow(
        /disabled in production/,
      );
      expect(() => assertProductionMigrationCommand("development", ["node", "payload", command])).not.toThrow();
    },
  );

  it("makes the baseline irreversible and requires its head only in production", async () => {
    await expect(down()).rejects.toThrow(/irreversible/);
    expect(shouldRequireCmsMigrationHead("production")).toBe(true);
    expect(shouldRequireCmsMigrationHead("development")).toBe(false);
    expect(shouldRequireCmsMigrationHead("test")).toBe(false);
  });

  it("adopts only a complete push-era schema", () => {
    expect(shouldAdoptCmsBaseline([])).toBe(false);
    expect(shouldAdoptCmsBaseline(CMS_BASELINE_TABLES)).toBe(true);
    expect(() => shouldAdoptCmsBaseline(["sellers", "payload_migrations"])).toThrow(/incomplete CMS schema/);
  });
});

describe.skipIf(!lifecycleEnabled)("PostgreSQL migration lifecycle (explicit disposable database)", () => {
  it("migrates a fresh schema, repeats safely, and detects a wrong head", async () => {
    await dropCmsSchema("migration-fresh-reset");
    await runMigrations();
    await withMigratingPayload("migration-fresh-check", async (payload) => {
      await expect(assertCmsMigrationHead(payload)).resolves.toBeUndefined();
      const result = await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'cms'`,
      });
      expect((result.rows as Array<{ table_name: string }>).map(({ table_name }) => table_name)).toEqual(
        expect.arrayContaining(["sellers", "operators", "offerings", "kiv1_sellers", "payload_migrations"]),
      );

      const sentinel = await payload.create({
        collection: "kiv1_sellers",
        data: { name: `migration-sentinel-${crypto.randomUUID()}`, status: "active" },
        overrideAccess: true,
      });
      await runMigrations();
      await expect(
        payload.findByID({ collection: "kiv1_sellers", id: sentinel.id, overrideAccess: true }),
      ).resolves.toMatchObject({ id: sentinel.id, name: sentinel.name });

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
  }, 120_000);

  it("adopts a complete push-era schema and preserves its v1 data", async () => {
    await dropCmsSchema("migration-adoption-reset");
    const originalForcePush = process.env.PAYLOAD_FORCE_DRIZZLE_PUSH;
    process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = "true";
    const pushed = await getPayload({ config, key: "migration-adoption-push" });
    let sentinel: Awaited<ReturnType<typeof pushed.create>>;
    try {
      sentinel = await pushed.create({
        collection: "kiv1_sellers",
        data: { name: `adoption-sentinel-${crypto.randomUUID()}`, status: "active" },
        overrideAccess: true,
      });
    } finally {
      await pushed.destroy();
      if (originalForcePush === undefined) delete process.env.PAYLOAD_FORCE_DRIZZLE_PUSH;
      else process.env.PAYLOAD_FORCE_DRIZZLE_PUSH = originalForcePush;
    }

    await runMigrations();
    await withMigratingPayload("migration-adoption-check", async (payload) => {
      await expect(assertCmsMigrationHead(payload)).resolves.toBeUndefined();
      await expect(
        payload.findByID({ collection: "kiv1_sellers", id: sentinel.id, overrideAccess: true }),
      ).resolves.toMatchObject({ id: sentinel.id, name: sentinel.name });
    });
  }, 120_000);
});
