import {
  MEAL_LABELS,
  WEEK_DAYS,
  draftPlanDtoSchema,
  weeklyMenuPlanDtoSchema,
  type DraftPlanDto,
  type WeeklyMenuPlanDto
} from "@cfp/weekly-menu-shared";
import type { Pool, PoolClient, QueryResultRow } from "pg";

export type WeeklyMenuIdentity = Readonly<{
  id: string;
  wechatOpenId: string;
}>;

export type ActiveSession = Readonly<{
  id: string;
  identityId: string;
  expiresAt: string;
}>;

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is required`);
  }
}

function asDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertPlanItems(client: PoolClient, plan: DraftPlanDto): Promise<void> {
  for (const [dayIndex, day] of plan.days.entries()) {
    for (const [mealIndex, meal] of day.meals.entries()) {
      await client.query(
        `INSERT INTO weekly_menu_plan_items
          (plan_id, day_index, meal_index, big_meat, small_meat, vegetable)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [plan.id, dayIndex, mealIndex, meal.bigMeat, meal.smallMeat, meal.vegetable]
      );
    }
  }
}

function planFromRows(planRow: QueryResultRow, itemRows: QueryResultRow[]): WeeklyMenuPlanDto {
  const byPosition = new Map(
    itemRows.map((row) => [`${row.day_index}:${row.meal_index}`, row])
  );
  return weeklyMenuPlanDtoSchema.parse({
    contractVersion: Number(planRow.contract_version),
    id: planRow.id,
    weekStart: asDate(planRow.week_start),
    sourcePlanId: planRow.source_plan_id,
    status: planRow.status,
    confirmedAt: planRow.confirmed_at ? asTimestamp(planRow.confirmed_at) : null,
    days: WEEK_DAYS.map((day, dayIndex) => ({
      day,
      meals: MEAL_LABELS.map((label, mealIndex) => {
        const row = byPosition.get(`${dayIndex}:${mealIndex}`);
        return {
          label,
          bigMeat: row?.big_meat,
          smallMeat: row?.small_meat,
          vegetable: row?.vegetable
        };
      })
    }))
  });
}

export class WeeklyMenuStore {
  constructor(private readonly pool: Pool) {}

  async upsertWechatIdentity(identity: WeeklyMenuIdentity): Promise<WeeklyMenuIdentity> {
    assertIdentifier(identity.id, "identity.id");
    assertIdentifier(identity.wechatOpenId, "identity.wechatOpenId");
    const result = await this.pool.query(
      `INSERT INTO weekly_menu_identities (id, wechat_open_id)
       VALUES ($1, $2)
       ON CONFLICT (wechat_open_id) DO UPDATE SET updated_at = now()
       RETURNING id, wechat_open_id`,
      [identity.id, identity.wechatOpenId]
    );
    const row = result.rows[0]!;
    return { id: row.id, wechatOpenId: row.wechat_open_id };
  }

  async createSession(input: Readonly<{
    id: string;
    identityId: string;
    tokenHash: string;
    expiresAt: string;
  }>): Promise<void> {
    assertIdentifier(input.id, "session.id");
    assertIdentifier(input.identityId, "session.identityId");
    assertIdentifier(input.tokenHash, "session.tokenHash");
    await this.pool.query(
      `INSERT INTO weekly_menu_sessions (id, identity_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.identityId, input.tokenHash, input.expiresAt]
    );
  }

  async findActiveSession(tokenHash: string, now = new Date()): Promise<ActiveSession | null> {
    assertIdentifier(tokenHash, "session.tokenHash");
    const result = await this.pool.query(
      `SELECT id, identity_id, expires_at
       FROM weekly_menu_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash, now]
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, identityId: row.identity_id, expiresAt: asTimestamp(row.expires_at) }
      : null;
  }

  async revokeSession(identityId: string, sessionId: string, revokedAt = new Date()): Promise<boolean> {
    assertIdentifier(identityId, "identityId");
    assertIdentifier(sessionId, "sessionId");
    const result = await this.pool.query(
      `UPDATE weekly_menu_sessions SET revoked_at = $3
       WHERE id = $1 AND identity_id = $2 AND revoked_at IS NULL`,
      [sessionId, identityId, revokedAt]
    );
    return result.rowCount === 1;
  }

  async createDraftPlan(ownerId: string, input: DraftPlanDto): Promise<void> {
    assertIdentifier(ownerId, "ownerId");
    const plan = draftPlanDtoSchema.parse(input);
    await inTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO weekly_menu_plans
          (id, owner_identity_id, contract_version, week_start, source_plan_id, status, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', NULL)`,
        [plan.id, ownerId, plan.contractVersion, plan.weekStart, plan.sourcePlanId]
      );
      await insertPlanItems(client, plan);
    });
  }

  async findPlan(ownerId: string, planId: string): Promise<WeeklyMenuPlanDto | null> {
    assertIdentifier(ownerId, "ownerId");
    assertIdentifier(planId, "planId");
    const planResult = await this.pool.query(
      `SELECT id, contract_version, week_start, source_plan_id, status, confirmed_at
       FROM weekly_menu_plans WHERE id = $1 AND owner_identity_id = $2`,
      [planId, ownerId]
    );
    const planRow = planResult.rows[0];
    if (!planRow) return null;
    const itemsResult = await this.pool.query(
      `SELECT day_index, meal_index, big_meat, small_meat, vegetable
       FROM weekly_menu_plan_items WHERE plan_id = $1 ORDER BY day_index, meal_index`,
      [planId]
    );
    return planFromRows(planRow, itemsResult.rows);
  }

  async replaceDraftPlan(ownerId: string, input: DraftPlanDto): Promise<boolean> {
    assertIdentifier(ownerId, "ownerId");
    const plan = draftPlanDtoSchema.parse(input);
    return inTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE weekly_menu_plans
         SET week_start = $3, source_plan_id = $4, updated_at = now()
         WHERE id = $1 AND owner_identity_id = $2 AND status = 'draft'`,
        [plan.id, ownerId, plan.weekStart, plan.sourcePlanId]
      );
      if (result.rowCount !== 1) return false;
      await client.query("DELETE FROM weekly_menu_plan_items WHERE plan_id = $1", [plan.id]);
      await insertPlanItems(client, plan);
      return true;
    });
  }

  async confirmDraftPlan(ownerId: string, planId: string, confirmedAt: string): Promise<boolean> {
    assertIdentifier(ownerId, "ownerId");
    assertIdentifier(planId, "planId");
    const result = await this.pool.query(
      `UPDATE weekly_menu_plans
       SET status = 'confirmed', confirmed_at = $3, updated_at = now()
       WHERE id = $1 AND owner_identity_id = $2 AND status = 'draft'`,
      [planId, ownerId, confirmedAt]
    );
    return result.rowCount === 1;
  }

  async deleteDraftPlan(ownerId: string, planId: string): Promise<boolean> {
    assertIdentifier(ownerId, "ownerId");
    assertIdentifier(planId, "planId");
    const result = await this.pool.query(
      `DELETE FROM weekly_menu_plans
       WHERE id = $1 AND owner_identity_id = $2 AND status = 'draft'`,
      [planId, ownerId]
    );
    return result.rowCount === 1;
  }
}
