import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  MEAL_LABELS,
  WEEK_DAYS,
  WEEKLY_MENU_CONTRACT_VERSION,
  type DraftPlanDto
} from "@cfp/weekly-menu-shared";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WeeklyMenuStore } from "./store";

const databaseUrl = process.env.WEEKLY_MENU_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe.sequential : describe.skip;
const execFileAsync = promisify(execFile);
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : undefined;
const store = pool ? new WeeklyMenuStore(pool) : undefined;

function makeDraft(id: string, sourcePlanId: string | null = null): DraftPlanDto {
  return {
    contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
    id,
    weekStart: "2026-08-03",
    sourcePlanId,
    status: "draft",
    confirmedAt: null,
    days: WEEK_DAYS.map((day, dayIndex) => ({
      day,
      meals: MEAL_LABELS.map((label, mealIndex) => ({
        label,
        bigMeat: `大荤-${dayIndex}-${mealIndex}`,
        smallMeat: `小荤-${dayIndex}-${mealIndex}`,
        vegetable: `素菜-${dayIndex}-${mealIndex}`
      }))
    }))
  };
}

describeWithDatabase("weekly-menu PostgreSQL persistence", () => {
  beforeAll(async () => {
    await Promise.all([
      execFileAsync(process.execPath, ["scripts/migrate.mjs"], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, WEEKLY_MENU_DATABASE_URL: databaseUrl }
      }),
      execFileAsync(process.execPath, ["scripts/migrate.mjs"], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, WEEKLY_MENU_DATABASE_URL: databaseUrl }
      })
    ]);
    await execFileAsync(process.execPath, ["scripts/migrate.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, WEEKLY_MENU_DATABASE_URL: databaseUrl }
    });
  });

  beforeEach(async () => {
    await pool!.query(
      "TRUNCATE weekly_menu_plan_items, weekly_menu_plans, weekly_menu_sessions, weekly_menu_identities CASCADE"
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("migrates an empty database once using only weekly_menu names", async () => {
    const tables = await pool!.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name LIKE 'weekly_menu_%'
       ORDER BY table_name`
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "weekly_menu_identities",
      "weekly_menu_migrations",
      "weekly_menu_plan_items",
      "weekly_menu_plans",
      "weekly_menu_sessions"
    ]);
    const migrations = await pool!.query("SELECT name FROM weekly_menu_migrations");
    expect(migrations.rows).toEqual([{ name: "0001_initial.sql" }]);
  });

  it("accepts only active sessions and scopes revocation to their identity", async () => {
    await store!.upsertWechatIdentity({ id: "owner-1", wechatOpenId: "openid-1" });
    await store!.createSession({
      id: "session-active",
      identityId: "owner-1",
      tokenHash: "active-token-hash",
      expiresAt: "2100-01-03T00:00:00Z"
    });
    await store!.createSession({
      id: "session-expired",
      identityId: "owner-1",
      tokenHash: "expired-token-hash",
      expiresAt: "2100-01-01T00:00:00Z"
    });

    await expect(
      store!.findActiveSession("active-token-hash", new Date("2100-01-02T00:00:00Z"))
    ).resolves.toMatchObject({ id: "session-active", identityId: "owner-1" });
    await expect(
      store!.findActiveSession("expired-token-hash", new Date("2100-01-02T00:00:00Z"))
    ).resolves.toBeNull();
    await expect(store!.revokeSession("foreign-owner", "session-active")).resolves.toBe(false);
    await expect(store!.revokeSession("owner-1", "session-active")).resolves.toBe(true);
    await expect(
      store!.findActiveSession("active-token-hash", new Date("2100-01-02T00:00:00Z"))
    ).resolves.toBeNull();
    await expect(
      store!.createSession({ id: "anonymous", identityId: "", tokenHash: "hash", expiresAt: "2026-09-01T00:00:00Z" })
    ).rejects.toThrow("session.identityId is required");
  });

  it("rejects anonymous and cross-owner plan access", async () => {
    await store!.upsertWechatIdentity({ id: "owner-1", wechatOpenId: "openid-1" });
    await store!.upsertWechatIdentity({ id: "owner-2", wechatOpenId: "openid-2" });
    const draft = makeDraft("plan-1");
    await store!.createDraftPlan("owner-1", draft);

    await expect(store!.findPlan("owner-2", draft.id)).resolves.toBeNull();
    await expect(store!.replaceDraftPlan("owner-2", draft)).resolves.toBe(false);
    await expect(
      store!.confirmDraftPlan("owner-2", draft.id, "2100-01-02T08:00:00Z")
    ).resolves.toBe(false);
    await expect(store!.deleteDraftPlan("owner-2", draft.id)).resolves.toBe(false);
    await expect(store!.createDraftPlan("", makeDraft("anonymous-plan"))).rejects.toThrow(
      "ownerId is required"
    );
    await expect(store!.findPlan("owner-1", draft.id)).resolves.toEqual(draft);
  });

  it("makes confirmed plans immutable in both the DAL and database", async () => {
    await store!.upsertWechatIdentity({ id: "owner-1", wechatOpenId: "openid-1" });
    const draft = makeDraft("plan-1");
    await store!.createDraftPlan("owner-1", draft);
    await expect(
      store!.confirmDraftPlan("owner-1", draft.id, "2100-01-02T08:00:00Z")
    ).resolves.toBe(true);
    await expect(store!.findPlan("owner-1", draft.id)).resolves.toMatchObject({
      status: "confirmed",
      confirmedAt: "2100-01-02T08:00:00.000Z"
    });
    await expect(store!.replaceDraftPlan("owner-1", draft)).resolves.toBe(false);
    await expect(store!.deleteDraftPlan("owner-1", draft.id)).resolves.toBe(false);
    await expect(
      pool!.query(
        "UPDATE weekly_menu_plan_items SET vegetable = '越权修改' WHERE plan_id = $1",
        [draft.id]
      )
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      pool!.query("DELETE FROM weekly_menu_plans WHERE id = $1", [draft.id])
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("requires all 14 meals and a same-owner source before confirmation", async () => {
    await store!.upsertWechatIdentity({ id: "owner-1", wechatOpenId: "openid-1" });
    await store!.upsertWechatIdentity({ id: "owner-2", wechatOpenId: "openid-2" });
    await pool!.query(
      `INSERT INTO weekly_menu_plans (id, owner_identity_id, contract_version, week_start)
       VALUES ('incomplete', 'owner-1', 1, '2026-08-03')`
    );
    await expect(
      pool!.query(
        "UPDATE weekly_menu_plans SET status = 'confirmed', confirmed_at = now() WHERE id = 'incomplete'"
      )
    ).rejects.toMatchObject({ code: "23514" });

    await store!.createDraftPlan("owner-1", makeDraft("source"));
    await expect(
      store!.createDraftPlan("owner-1", makeDraft("copy-from-draft", "source"))
    ).rejects.toMatchObject({ code: "23514" });
    await store!.confirmDraftPlan("owner-1", "source", "2100-01-02T08:00:00Z");
    await expect(
      store!.createDraftPlan("owner-1", makeDraft("copy", "source"))
    ).resolves.toBeUndefined();
    await expect(store!.findPlan("owner-1", "copy")).resolves.toMatchObject({
      sourcePlanId: "source",
      status: "draft"
    });
    await expect(
      store!.createDraftPlan("owner-2", makeDraft("foreign-copy", "source"))
    ).rejects.toMatchObject({ code: "23514" });
  });
});
