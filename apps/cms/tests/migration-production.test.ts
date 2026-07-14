import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "../payload.config";
import { migrations } from "../migrations/generated";
import {
  assertMigrationHead,
  assertMigrationHistorySafe,
  databasePushEnabled,
} from "../migrations/production";

const execFileAsync = promisify(execFile);
const configuredDatabaseUrl = process.env.PAYLOAD_DATABASE_URL || process.env.DATABASE_URL;
const databaseName = `cms_migration_${process.pid}_${Date.now()}`;
let adminPayload: Payload | undefined;

const isolatedDatabaseUrl = (): string => {
  const url = new URL(configuredDatabaseUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const runMigration = () => execFileAsync(
  "pnpm",
  ["--filter", "@cfp/cms", "exec", "tsx", "migrations/run.ts"],
  {
    cwd: new URL("../../..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PAYLOAD_DB_PUSH: "false",
      PAYLOAD_DATABASE_URL: isolatedDatabaseUrl(),
      PAYLOAD_SECRET: "migration-integration-secret",
    },
  },
);

describe("production migration policy", () => {
  it("keeps push local-only even when an outer production process asks for it", () => {
    expect(databasePushEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(databasePushEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(databasePushEnabled({ NODE_ENV: "production", PAYLOAD_DB_PUSH: "true" })).toBe(false);
    expect(databasePushEnabled({ NODE_ENV: "test", PAYLOAD_DB_PUSH: "false" })).toBe(false);
  });

  it("accepts only the complete committed head and rejects missing or foreign history", () => {
    const expected = migrations.map(({ name }) => name);
    const applied = expected.map((name) => ({ name, batch: 1 }));
    expect(() => assertMigrationHead(applied, expected)).not.toThrow();
    expect(() => assertMigrationHead([...applied], expected)).not.toThrow();
    expect(() => assertMigrationHead([], expected)).toThrow(/migration head mismatch/);
    expect(() => assertMigrationHead(applied.slice(0, -1), expected)).toThrow(/migration head mismatch/);
    expect(() => assertMigrationHead([...applied, { name: "20990101_uncommitted", batch: 2 }], expected)).toThrow(/migration head mismatch/);
    expect(() => assertMigrationHead(applied.map((entry) => ({ ...entry, batch: -1 })), expected)).toThrow(/migration head mismatch/);
    expect(() => assertMigrationHead([{ name: "002", batch: 1 }, { name: "001", batch: 1 }], ["001", "002"])).toThrow(/migration head mismatch/);
    expect(() => assertMigrationHistorySafe(applied.slice(0, -1), expected)).not.toThrow();
    expect(() =>
      assertMigrationHistorySafe([{ name: "002", batch: 1 }], ["001", "002"]),
    ).toThrow(/unsafe migration history/);
    expect(() =>
      assertMigrationHistorySafe(
        [{ name: "001", batch: 1 }, { name: "001", batch: 1 }],
        ["001", "001"],
      ),
    ).toThrow(/unsafe migration history/);
    expect(() => assertMigrationHistorySafe([{ name: "dev", batch: -1 }], expected)).toThrow(/unsafe migration history/);
    expect(() => assertMigrationHistorySafe([{ name: "20990101_uncommitted", batch: 2 }], expected)).toThrow(/unsafe migration history/);
  });

  it("exposes an explicit production runner without destructive migration scripts", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    expect(pkg.default.scripts["payload:migrate:production"]).toBe(
      "NODE_ENV=production PAYLOAD_DB_PUSH=false tsx migrations/run.ts",
    );
    expect(Object.values(pkg.default.scripts).join(" ")).not.toMatch(/migrate:(?:fresh|reset|refresh)/);
  });
});

describe.skipIf(!configuredDatabaseUrl)("production migration against PostgreSQL", () => {
  beforeAll(async () => {
    adminPayload = await getPayload({ config });
    await adminPayload.db.pool.query(`CREATE DATABASE "${databaseName}"`);
  }, 60_000);

  afterAll(async () => {
    if (!adminPayload) return;
    await adminPayload.db.pool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1",
      [databaseName],
    );
    await adminPayload.db.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminPayload.destroy();
  });

  it("migrates a fresh database and is a no-op at the same head on repeat", async () => {
    const first = await runMigration();
    expect(first.stdout).toContain("cms migration head");
    const pool = new adminPayload!.db.pg!.Pool({ connectionString: isolatedDatabaseUrl() });
    try {
      await pool.query("INSERT INTO cms.kiv1_sellers (name) VALUES ($1)", ["v1-migration-sentinel"]);
      const second = await runMigration();
      expect(second.stdout).toContain("cms migration head");
      const sentinel = await pool.query("SELECT name FROM cms.kiv1_sellers");
      expect(sentinel.rows).toEqual([{ name: "v1-migration-sentinel" }]);
      const indexes = await pool.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname = 'cms' AND indexname = ANY($1)",
        [[
          "service_slots_seller_date_occasion_unique",
          "orders_seller_customer_date_occasion_unique",
          "orders_seller_idempotency_key_unique",
          "fulfillments_seller_order_unique",
          "orders_seller_date_occasion_status_payment_status_idx",
          "orders_seller_customer_status_placed_at_idx",
          "fulfillments_seller_service_date_occasion_status_idx",
          "chat_messages_seller_operator_created_at_idx",
          "menu_plans_seller_slot_unique",
        ]],
      );
      expect(indexes.rowCount).toBe(9);
    } finally {
      await pool.end();
    }
  }, 120_000);

  it("fails closed before migrate for foreign or development-push history", async () => {
    const pool = new adminPayload!.db.pg!.Pool({ connectionString: isolatedDatabaseUrl() });
    try {
      await pool.query(
        "INSERT INTO cms.payload_migrations (name, batch, updated_at, created_at) VALUES ($1, 2, now(), now())",
        ["20990101_uncommitted"],
      );
      await expect(runMigration()).rejects.toMatchObject({
        stderr: expect.stringContaining("unsafe migration history"),
      });
      await pool.query(
        "UPDATE cms.payload_migrations SET name = 'dev', batch = -1 WHERE name = '20990101_uncommitted'",
      );
      await expect(runMigration()).rejects.toMatchObject({
        stderr: expect.stringContaining("unsafe migration history"),
      });
    } finally {
      await pool.end();
    }
  }, 60_000);
});
