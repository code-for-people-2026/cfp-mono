import type { Payload } from "payload";
import { sql } from "@payloadcms/db-postgres";

/**
 * Indexes/constraints drizzle push does NOT recreate from collection configs
 * (collections only declare per-field `index: true`, and Payload `indexes` can't
 * express partial predicates) — the six from the original CMS migration:
 *
 * Partial-unique (WHERE clause):
 *   - service_slots (seller, date, occasion) WHERE occasion IS NOT NULL
 *       → 最近一餐定位 + 首单 upsert 命中键
 *   - orders (seller, customer, date, occasion) WHERE status IN ('draft','confirmed')
 *       → active 业务唯一坐标（重复粘贴同坐标更新，而非新增重复 order）
 *   - orders (seller, idempotency_key) WHERE idempotency_key IS NOT NULL
 *       → 技术幂等（防同一次提交/订阅物化 job 重复写）
 *
 * Composite lookup (non-unique, performance — kept here, not in collection
 * `indexes`, so all push-bypass indexes live in one auditable place):
 *   - orders (seller, date, occasion, status, paymentStatus) → 今天某餐确认订单 / 谁没付款
 *   - orders (seller, customer, status, placedAt) → 张阿姨上次点啥（backward scan）
 *   - fulfillments (seller, serviceDate, occasion, status) → 谁没送 / 缺口对账
 *   - chat_messages (seller, operator, createdAt) → 展示对话分页拉取 + 留存裁剪
 *
 * Run on every Payload init via `onInit`. push rebuilds tables/columns but leaves
 * these alone, so re-create idempotently (`IF NOT EXISTS`) — even if a future
 * push ever dropped one, the next boot restores it.
 *
 * SQLite fallback (no DATABASE_URL) has no schema concept → bail unless postgres.
 *
 * Release 后转 migration 时，这些并入 baseline migration 的 up；onInit 仍幂等保留无妨
 * （约束/索引在 migration 已建，IF NOT EXISTS 跳过）。
 */
export async function ensureConstraints(payload: Payload): Promise<void> {
  // SQLite fallback (no DATABASE_URL) has no schemas — the cms.-qualified SQL below
  // would error. Only postgres carries these.
  if (payload.db.name !== "postgres") return;

  // ── partial-unique constraints (WHERE clause Payload `indexes` can't express) ──
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

  // ── composite lookup indexes (non-unique, performance) ──
  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE INDEX IF NOT EXISTS "orders_seller_date_occasion_status_payment_status_idx"
        ON "cms"."orders" ("seller_id", "date", "occasion", "status", "payment_status")
    `,
  });

  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE INDEX IF NOT EXISTS "orders_seller_customer_status_placed_at_idx"
        ON "cms"."orders" ("seller_id", "customer_id", "status", "placed_at")
    `,
  });

  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE INDEX IF NOT EXISTS "fulfillments_seller_service_date_occasion_status_idx"
        ON "cms"."fulfillments" ("seller_id", "service_date", "occasion", "status")
    `,
  });

  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE INDEX IF NOT EXISTS "chat_messages_seller_operator_created_at_idx"
        ON "cms"."chat_messages" ("seller_id", "operator_id", "created_at")
    `,
  });

  // ── one-plan-per-slot invariant (feature 003): a menu_plan is unique per (seller, slot).
  //    Backs the upsert's find-then-create against concurrent races; without it two
  //    generate requests for the same meal could both create, leaving duplicate plans.
  await payload.db.execute({
    drizzle: payload.db.drizzle,
    sql: sql`
      CREATE UNIQUE INDEX IF NOT EXISTS "menu_plans_seller_slot_unique"
        ON "cms"."menu_plans" ("seller_id", "slot_id")
    `,
  });
}
