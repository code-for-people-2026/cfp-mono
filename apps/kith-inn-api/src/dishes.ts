import {
  DishBatchInputSchema, DishBatchResultSchema, DishListSchema, DishSchema,
  DishUpdateInputSchema, DishDeleteInputSchema, IdSchema, type Dish
} from "@cfp/kith-inn-contracts";
import type { Pool } from "pg";
import { ApiError } from "./auth";
import { idempotent } from "./idempotency";
import { Sessions, type ActiveSession } from "./sessions";

const columns = 'id, name, category, active, version, created_at AS "createdAt", updated_at AS "updatedAt"';
type Row = Omit<Dish, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };
const toDish = (row: Row) => DishSchema.parse({ ...row,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const invalid = () => new ApiError(400, "INVALID_REQUEST", "菜品信息不正确");
const limit = (field: string) => new ApiError(422, "LIMIT_EXCEEDED", "菜品数量超过上限", { field });
const duplicate = (names: string[]) => new ApiError(409, "DUPLICATE_DISH_NAME", "菜名已存在，请修改或恢复已有菜品", { names });
const conflict = (currentVersion: number) => new ApiError(409, "VERSION_CONFLICT", "菜品已更新，请重新读取", { currentVersion });

export class Dishes {
  constructor(private readonly pool: Pool, private readonly sessions: Sessions,
    private readonly clock: () => Date = () => new Date()) {}

  async list(session: ActiveSession) {
    const result = await this.pool.query<Row>(`SELECT ${columns} FROM dishes WHERE merchant_id = $1 ORDER BY name`, [session.merchantId]);
    return DishListSchema.parse({ items: result.rows.map(toDish) });
  }

  async create(session: ActiveSession, key: string, body: unknown) {
    if (body && typeof body === "object" && "items" in body && Array.isArray(body.items) && body.items.length > 200) throw limit("items");
    const parsed = DishBatchInputSchema.safeParse(body);
    if (!parsed.success) throw invalid();
    const data = parsed.data;
    return this.sessions.withSession(session, (client) => idempotent(client, session.merchantId, key,
      { method: "POST", path: "/api/kith-inn/dishes", body: data }, async () => {
        const names = data.items.map((item) => item.name);
        const existing = await client.query<{ name: string }>(
          "SELECT name FROM dishes WHERE merchant_id = $1 AND name = ANY($2::text[])", [session.merchantId, names]);
        const repeated = names.filter((name, index) => names.indexOf(name) !== index);
        const conflicts = [...new Set([...repeated, ...existing.rows.map((row) => row.name)])];
        if (conflicts.length) throw duplicate(conflicts);
        const count = await client.query("SELECT count(*)::int AS total FROM dishes WHERE merchant_id = $1", [session.merchantId]);
        if (count.rows[0].total + data.items.length > 1000) throw limit("dishes");
        const saved = await client.query<Row>(`INSERT INTO dishes (merchant_id, name, category)
          SELECT $1, name, category FROM jsonb_to_recordset($2::jsonb) AS input(name text, category text)
          RETURNING ${columns}`, [session.merchantId, JSON.stringify(data.items)]);
        return { status: 201, body: DishBatchResultSchema.parse({ items: saved.rows.map(toDish) }) };
      }, this.clock()));
  }

  async delete(session: ActiveSession, key: string, id: string, body: unknown) {
    const parsed = DishDeleteInputSchema.safeParse(body), parsedId = IdSchema.safeParse(id);
    if (!parsed.success || !parsedId.success) throw invalid();
    const data = parsed.data, dishId = parsedId.data.toLowerCase();
    return this.sessions.withSession(session, (client) => idempotent(client, session.merchantId, key,
      { method: "DELETE", path: `/api/kith-inn/dishes/${dishId}`, body: data }, async () => {
        const current = await client.query("SELECT version FROM dishes WHERE merchant_id = $1 AND id = $2", [session.merchantId, dishId]);
        if (!current.rowCount) throw new ApiError(404, "NOT_FOUND", "没有找到该菜品");
        if (current.rows[0].version !== data.baseVersion) throw conflict(current.rows[0].version);
        // Saved weeks own their snapshots; deleting a pool entry must not rewrite them.
        await client.query("DELETE FROM dishes WHERE merchant_id = $1 AND id = $2", [session.merchantId, dishId]);
        return { status: 200, body: { id: dishId } };
      }, this.clock()));
  }

  async update(session: ActiveSession, key: string, id: string, body: unknown) {
    const parsed = DishUpdateInputSchema.safeParse(body), parsedId = IdSchema.safeParse(id);
    if (!parsed.success || !parsedId.success) throw invalid();
    const data = parsed.data, dishId = parsedId.data.toLowerCase();
    return this.sessions.withSession(session, (client) => idempotent(client, session.merchantId, key,
      { method: "PATCH", path: `/api/kith-inn/dishes/${dishId}`, body: data }, async () => {
        const current = await client.query("SELECT version FROM dishes WHERE merchant_id = $1 AND id = $2", [session.merchantId, dishId]);
        if (!current.rowCount) throw new ApiError(404, "NOT_FOUND", "没有找到该菜品");
        if (current.rows[0].version !== data.baseVersion) throw conflict(current.rows[0].version);
        const existing = await client.query("SELECT 1 FROM dishes WHERE merchant_id = $1 AND name = $2 AND id <> $3",
          [session.merchantId, data.name, dishId]);
        if (existing.rowCount) throw duplicate([data.name]);
        const saved = await client.query<Row>(`UPDATE dishes SET name = $3, category = $4, active = $5,
          version = version + 1, updated_at = $7 WHERE merchant_id = $1 AND id = $2 AND version = $6 RETURNING ${columns}`,
        [session.merchantId, dishId, data.name, data.category, data.active, data.baseVersion, this.clock()]);
        if (!saved.rowCount) {
          const latest = await client.query("SELECT version FROM dishes WHERE merchant_id = $1 AND id = $2", [session.merchantId, dishId]);
          throw conflict(latest.rows[0]?.version ?? 0);
        }
        return { status: 200, body: toDish(saved.rows[0]!) };
      }, this.clock()));
  }
}
