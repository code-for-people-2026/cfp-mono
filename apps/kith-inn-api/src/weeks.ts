import { isDeepStrictEqual } from "node:util";
import {
  CategorySchema, GenerateInputSchema, WeekListQuerySchema, WeekListSchema,
  WeekPlanSchema, WeekStartSchema, WeekWriteInputSchema,
  type Dish, type MealSnapshot, type WeekPlan
} from "@cfp/kith-inn-contracts";
import type { Pool } from "pg";
import { ApiError } from "./auth";
import { Dishes } from "./dishes";
import { generateMenu } from "./generate";
import { idempotent } from "./idempotency";
import { Sessions, type ActiveSession } from "./sessions";

const columns = `id, week_start::text AS "weekStart", structure, meals, version,
  confirmed_at AS "confirmedAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
type Row = Omit<WeekPlan, "confirmedAt" | "createdAt" | "updatedAt"> & {
  confirmedAt: Date | null; createdAt: Date; updatedAt: Date;
};
const toWeek = (row: Row) => WeekPlanSchema.parse({ ...row, confirmedAt: row.confirmedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const invalid = () => new ApiError(400, "INVALID_REQUEST", "周菜单信息不正确");
const conflict = (currentVersion: number) => new ApiError(409, "VERSION_CONFLICT", "菜单已在另一处更新，请重新读取后再调整", { currentVersion });
function validWeek(weekStart: string) { if (!WeekStartSchema.safeParse(weekStart).success) throw invalid(); }

export class Weeks {
  constructor(private readonly pool: Pool, private readonly sessions: Sessions,
    private readonly clock: () => Date = () => new Date()) {}

  async list(session: ActiveSession, query: unknown = {}) {
    const parsed = WeekListQuerySchema.safeParse(query);
    if (!parsed.success) throw invalid();
    const { before, limit } = parsed.data;
    const { rows } = await this.pool.query<Row>(`SELECT week_start::text AS "weekStart", version,
      confirmed_at AS "confirmedAt", updated_at AS "updatedAt" FROM week_plans
      WHERE merchant_id = $1 AND ($2::date IS NULL OR week_start < $2)
      ORDER BY week_start DESC LIMIT $3`, [session.merchantId, before ?? null, limit + 1]);
    const items = rows.slice(0, limit).map((row) => ({ weekStart: row.weekStart, version: row.version,
      confirmedAt: row.confirmedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() }));
    return WeekListSchema.parse({ items, nextBefore: rows.length > limit ? items.at(-1)!.weekStart : null });
  }

  async read(session: ActiveSession, weekStart: string) {
    validWeek(weekStart);
    const { rows: [row] } = await this.pool.query<Row>(`SELECT ${columns} FROM week_plans
      WHERE merchant_id = $1 AND week_start = $2`, [session.merchantId, weekStart]);
    if (!row) throw new ApiError(404, "NOT_FOUND", "这周还没有保存菜单");
    return toWeek(row);
  }

  async generate(session: ActiveSession, weekStart: string, body: unknown) {
    validWeek(weekStart);
    const parsed = GenerateInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.meals[0]?.date !== weekStart) throw invalid();
    return generateMenu(weekStart, parsed.data, (await new Dishes(this.pool, this.sessions).list(session)).items);
  }

  async save(session: ActiveSession, key: string, weekStart: string, body: unknown) {
    validWeek(weekStart);
    const parsed = WeekWriteInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.meals[0]?.date !== weekStart) throw invalid();
    const data = parsed.data;
    return this.sessions.withSession(session, (client) => idempotent(client, session.merchantId, key,
      { method: "PUT", path: `/api/kith-inn/weeks/${weekStart}`, body: data }, async () => {
        const { rows: [row] } = await client.query<Row>(`SELECT ${columns} FROM week_plans
          WHERE merchant_id = $1 AND week_start = $2`, [session.merchantId, weekStart]);
        const current = row ? toWeek(row) : undefined;
        if (data.baseVersion !== (current?.version ?? 0)) throw conflict(current?.version ?? 0);
        if (current && !data.rebuild && !isDeepStrictEqual(current.structure, data.structure)) throw invalid();
        const dishes = await client.query<Pick<Dish, "id" | "name" | "category" | "active">>(
          "SELECT id, name, category, active FROM dishes WHERE merchant_id = $1", [session.merchantId]);
        const byId = new Map(dishes.rows.map((dish) => [dish.id, dish]));
        const meals: MealSnapshot[] = data.meals.map((meal, mealIndex) => {
          const previous = current?.meals[mealIndex];
          const result: MealSnapshot = { ...meal, meat: [], vegetable: [], soup: [] };
          for (const category of CategorySchema.options) result[category] = meal[category].map((rawId, slot) => {
            const dishId = rawId.toLowerCase(), saved = previous?.[category][slot];
            const restoring = category === "soup" && previous?.soupOmitted && !meal.soupOmitted;
            if (!data.rebuild && !restoring && saved?.dishId.toLowerCase() === dishId) return saved;
            const dish = byId.get(dishId);
            if (!dish?.active || dish.category !== category) throw new ApiError(409, "DISH_UNAVAILABLE",
              "有菜品已删除、停用或改变分类，请重新选择", { field: `meals.${mealIndex}.${category}.${slot}` });
            return { dishId, name: dish.name };
          });
          return result;
        });
        const now = this.clock();
        const unchanged = current && isDeepStrictEqual(current.structure, data.structure) && isDeepStrictEqual(current.meals, meals);
        const confirmedAt = data.confirm ? (unchanged && current.confirmedAt ? new Date(current.confirmedAt) : now) : null;
        const values = [session.merchantId, weekStart, JSON.stringify(data.structure), JSON.stringify(meals), confirmedAt, now];
        const saved = current ? await client.query<Row>(`UPDATE week_plans SET structure = $3, meals = $4,
          confirmed_at = $5, updated_at = $6, version = version + 1
          WHERE merchant_id = $1 AND week_start = $2 AND version = $7 RETURNING ${columns}`, [...values, data.baseVersion]) :
          await client.query<Row>(`INSERT INTO week_plans (merchant_id, week_start, structure, meals, confirmed_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (merchant_id, week_start) DO NOTHING RETURNING ${columns}`, values);
        if (!saved.rowCount) {
          const latest = await client.query("SELECT version FROM week_plans WHERE merchant_id = $1 AND week_start = $2", [session.merchantId, weekStart]);
          throw conflict(latest.rows[0]?.version ?? 0);
        }
        return { status: 200, body: toWeek(saved.rows[0]!) };
      }, this.clock()));
  }
}
