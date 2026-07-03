import type { Payload } from "payload";
import { sql } from "@payloadcms/db-postgres";

/**
 * Partial-unique constraints Payload's `indexes` can't express (WHERE clause) —
 * the three business-critical uniques from the original CMS migration that drizzle
 * push does NOT recreate from collection configs (they only declare per-field
 * `index: true`):
 *   - service_slots (seller, date, occasion) WHERE occasion IS NOT NULL
 *       → 最近一餐定位 + 首单 upsert 命中键
 *   - orders (seller, customer, date, occasion) WHERE status IN ('draft','confirmed')
 *       → active 业务唯一坐标（重复粘贴同坐标更新，而非新增重复 order）
 *   - orders (seller, idempotency_key) WHERE idempotency_key IS NOT NULL
 *       → 技术幂等（防同一次提交/订阅物化 job 重复写）
 *
 * Run on every Payload init via `onInit`. push rebuilds tables/columns but leaves
 * these hand-written partial uniques alone, so we re-create them idempotently
 * (`IF NOT EXISTS`) — even if a future push ever dropped one, the next boot
 * restores it.
 *
 * SQLite fallback (no DATABASE_URL) has no schema concept → bail unless postgres.
 *
 * Release 后转 migration 时，这三条可并入 baseline migration 的 up；onInit 仍幂等
 * 保留无妨（约束在 migration 已建，IF NOT EXISTS 跳过）。
 */
export async function ensurePartialUniqueConstraints(payload: Payload): Promise<void> {
  // SQLite fallback (no DATABASE_URL) has no schemas — the cms.-qualified SQL below
  // would error. Only postgres carries these constraints.
  if (payload.db.name !== "postgres") return;

  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "service_slots_seller_date_occasion_unique"
        ON "cms"."service_slots" ("seller_id", "date", "occasion")
        WHERE "occasion" IS NOT NULL
    `,
  });

  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "orders_seller_customer_date_occasion_unique"
        ON "cms"."orders" ("seller_id", "customer_id", "date", "occasion")
        WHERE "status" IN ('draft', 'confirmed')
    `,
  });

  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "orders_seller_idempotency_key_unique"
        ON "cms"."orders" ("seller_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
    `,
  });
}
