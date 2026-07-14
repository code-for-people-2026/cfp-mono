import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "../payload.config";
import { resolveTrialOpenid } from "../seed/run";

const execFileAsync = promisify(execFile);
const configuredDatabaseUrl = process.env.PAYLOAD_DATABASE_URL || process.env.DATABASE_URL;
const databaseName = `cms_seed_${process.pid}_${Date.now()}`;
const trialOpenid = "trial-secret-openid";
let adminPayload: Payload | undefined;

const isolatedDatabaseUrl = () => {
  const url = new URL(configuredDatabaseUrl!);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

const run = (args: string[], openid = trialOpenid) => execFileAsync("pnpm", ["--filter", "@cfp/cms", "exec", "tsx", ...args], {
  cwd: new URL("../../..", import.meta.url),
  env: {
    ...process.env,
    NODE_ENV: "test",
    PAYLOAD_DB_PUSH: "false",
    PAYLOAD_DATABASE_URL: isolatedDatabaseUrl(),
    PAYLOAD_SECRET: "seed-integration-secret",
    KITH_INN_TRIAL_OPENID: openid,
  },
});

describe("production trial OpenID", () => {
  it("requires a non-placeholder secret in production and keeps dev fallback local", () => {
    expect(resolveTrialOpenid({ NODE_ENV: "development" })).toBe("taozi-dev-openid");
    expect(resolveTrialOpenid({ NODE_ENV: "test", KITH_INN_TRIAL_OPENID: trialOpenid })).toBe(trialOpenid);
    expect(() => resolveTrialOpenid({ NODE_ENV: "production" })).toThrow(/KITH_INN_TRIAL_OPENID/);
    expect(() => resolveTrialOpenid({ NODE_ENV: "production", KITH_INN_TRIAL_OPENID: "change-me" })).toThrow(/KITH_INN_TRIAL_OPENID/);
    expect(() => resolveTrialOpenid({ NODE_ENV: "production", KITH_INN_TRIAL_OPENID: "taozi-dev-openid" })).toThrow(/KITH_INN_TRIAL_OPENID/);
  });
});

describe.skipIf(!configuredDatabaseUrl)("production seed against PostgreSQL", () => {
  beforeAll(async () => {
    adminPayload = await getPayload({ config });
    await adminPayload.db.pool.query(`CREATE DATABASE "${databaseName}"`);
  }, 60_000);

  afterAll(async () => {
    if (!adminPayload) return;
    await adminPayload.db.pool.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1", [databaseName]);
    await adminPayload.db.pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminPayload.destroy();
  });

  it("migrates and seeds twice, preserves v1, rolls back a failure, then recovers", async () => {
    const pool = new adminPayload!.db.pg!.Pool({ connectionString: isolatedDatabaseUrl() });
    try {
      await run(["migrations/run.ts"]);
      await pool.query("INSERT INTO cms.kiv1_sellers (name) VALUES ($1)", ["v1-seed-sentinel"]);
      const first = await run(["seed/run.ts", "kith-inn"]);
      await run(["migrations/run.ts"]);
      const second = await run(["seed/run.ts", "kith-inn"]);
      expect(`${first.stdout}${first.stderr}${second.stdout}${second.stderr}`).not.toContain(trialOpenid);
      expect([first, second].map(({ stdout }) => JSON.parse(stdout.trim().split("\n").at(-1)!))).toEqual([
        expect.objectContaining({ project: "kith-inn", status: "provisioned", offeringCount: 20 }),
        expect.objectContaining({ project: "kith-inn", status: "reconciled", offeringCount: 20 }),
      ]);
      const taozi = await pool.query("SELECT id FROM cms.sellers WHERE name = '桃子'");
      expect(taozi.rowCount).toBe(1);
      const taoziId = taozi.rows[0].id;
      expect(await pool.query("SELECT count(*)::int AS count FROM cms.offerings WHERE seller_id = $1", [taoziId])).toMatchObject({ rows: [{ count: 21 }] });
      expect(await pool.query("SELECT wechat_openid FROM cms.operators WHERE email = 'taozi@kith-inn.local'")).toMatchObject({ rows: [{ wechat_openid: trialOpenid }] });
      expect(await pool.query("SELECT name FROM cms.kiv1_sellers")).toMatchObject({ rows: [{ name: "v1-seed-sentinel" }] });

      const other = await pool.query("INSERT INTO cms.sellers (name) VALUES ('冲突商家') RETURNING id");
      const conflictOpenid = "transaction-conflict-openid";
      await pool.query("INSERT INTO cms.operators (email, wechat_openid, seller_id) VALUES ($1, $2, $3)", ["other@kith-inn.local", conflictOpenid, other.rows[0].id]);
      await pool.query("UPDATE cms.sellers SET status = 'paused' WHERE name = '桃子'");
      await pool.query("UPDATE cms.offerings SET active = false WHERE seller_id = $1 AND name = '番茄炒蛋'", [taoziId]);
      await expect(run(["seed/run.ts", "kith-inn"], conflictOpenid)).rejects.toMatchObject({
        stdout: expect.not.stringContaining(conflictOpenid),
        stderr: expect.not.stringContaining(conflictOpenid),
      });
      expect(await pool.query("SELECT status FROM cms.sellers WHERE name = '桃子'")).toMatchObject({ rows: [{ status: "paused" }] });
      expect(await pool.query("SELECT active FROM cms.offerings WHERE seller_id = $1 AND name = '番茄炒蛋'", [taoziId])).toMatchObject({ rows: [{ active: false }] });
      expect(await pool.query("SELECT wechat_openid FROM cms.operators WHERE email = 'taozi@kith-inn.local'")).toMatchObject({ rows: [{ wechat_openid: trialOpenid }] });
      const recovered = await run(["seed/run.ts", "kith-inn"], "recovery-openid");
      expect(`${recovered.stdout}${recovered.stderr}`).not.toContain("recovery-openid");
      expect(await pool.query("SELECT status FROM cms.sellers WHERE name = '桃子'")).toMatchObject({ rows: [{ status: "active" }] });
      expect(await pool.query("SELECT active FROM cms.offerings WHERE seller_id = $1 AND name = '番茄炒蛋'", [taoziId])).toMatchObject({ rows: [{ active: true }] });
      expect(await pool.query("SELECT count(*)::int AS count FROM cms.operators WHERE seller_id = $1", [taoziId])).toMatchObject({ rows: [{ count: 1 }] });
      expect(await pool.query("SELECT count(*)::int AS count FROM cms.offerings WHERE seller_id = $1", [taoziId])).toMatchObject({ rows: [{ count: 21 }] });
      expect(await pool.query("SELECT wechat_openid FROM cms.operators WHERE seller_id = $1", [taoziId])).toMatchObject({ rows: [{ wechat_openid: "recovery-openid" }] });
      expect(await pool.query("SELECT name FROM cms.kiv1_sellers")).toMatchObject({ rows: [{ name: "v1-seed-sentinel" }] });
    } finally {
      await pool.end();
    }
  }, 120_000);
});
