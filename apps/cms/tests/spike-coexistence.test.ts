import { existsSync, readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@payloadcms/db-postgres";
import { getPayload } from "payload";
import type { Payload } from "payload";
import config, { schemaName } from "../payload.config";
import { GET as health } from "../src/app/api/health/route";

const oldSlugs = [
  "sellers",
  "operators",
  "customers",
  "offerings",
  "menu_plans",
  "service_slots",
  "orders",
  "order_items",
  "fulfillments",
  "chat_messages",
  "subscriptions",
];

const v1Slugs = [
  "kiv1_sellers",
  "kiv1_operators",
  "kiv1_customer_profiles",
  "kiv1_offerings",
  "kiv1_meal_slots",
  "kiv1_booking_batches",
  "kiv1_orders",
];

describe("shared CMS assembly", () => {
  it("registers the unchanged old collection list followed by seven v1 collections", async () => {
    const resolved = await config;
    expect(
      resolved.collections
        ?.map((collection) => collection.slug)
        .filter((slug) => !slug.startsWith("payload-")),
    ).toEqual([...oldSlugs, ...v1Slugs]);
  });

  it("keeps the existing Admin identity and v1 operator/access boundary", async () => {
    const resolved = await config;
    expect(resolved.admin.user).toBe("operators");
    const v1Collections = resolved.collections?.filter((collection) =>
      collection.slug.startsWith("kiv1_"),
    ) ?? [];
    expect(v1Collections.find((collection) => collection.slug === "kiv1_operators")?.auth).not.toBe(true);
    for (const collection of v1Collections) {
      for (const operation of ["read", "create", "update", "delete"] as const) {
        const access = collection.access[operation] as (args: { req: { user?: unknown } }) => unknown;
        expect(access({ req: {} }), `${collection.slug}.${operation} anonymous`).toBe(false);
      }
      const read = collection.access.read as (args: { req: { user?: unknown } }) => unknown;
      expect(read({ req: { user: { id: 1 } } }), `${collection.slug}.read admin`).toBe(true);
    }
  });

  it("keeps schema, port, health and old internal route surface unchanged", async () => {
    expect(schemaName).toBe("cms");
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts.dev).toBe("next dev -p 3304");
    expect(packageJson.scripts.start).toBe("next start -p 3304");
    await expect((await health()).json()).resolves.toEqual({ status: "ok" });
    expect(readdirSync(new URL("../src/app/api/internal", import.meta.url)).sort()).toEqual([
      "chat_messages",
      "customers",
      "fulfillments",
      "kiv1",
      "menu-plans",
      "offerings",
      "operator-by-openid",
      "orders",
      "seller",
      "service-slots",
    ]);
  });

  it("keeps one Payload host while M1 adds the two actual v1 product workspaces", () => {
    expect(existsSync(new URL("../../kith-inn-v1-cms", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../../kith-inn-v1-fe", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../../kith-inn-v1-be", import.meta.url))).toBe(true);
  });
});

/**
 * Spike (a): prove apps/cms (the shared host, schema "cms") coexists with
 * apps/website (schema "website") on the SAME Postgres instance, each in its own
 * schema, with no cross-contamination. sqlite cannot prove this (it ignores
 * schemaName), so this test only runs when a real DATABASE_URL is present
 * (CI + local `db:up`). It carries no enforceable line coverage (the isolation
 * logic it exercises lives in @cfp/kith-inn-payload).
 */
describe.skipIf(!process.env.DATABASE_URL && !process.env.PAYLOAD_DATABASE_URL)(
  "spike (a): cms schema isolation on a shared Postgres",
  () => {
    let payload: Payload;

    beforeAll(async () => {
      payload = await getPayload({ config });
    }, 60_000);

    afterAll(async () => {
      if (payload) await payload.destroy();
    });

    const tablesIn = async (schema: string): Promise<string[]> => {
      // The postgres adapter exposes `execute` as a standalone drizzle helper that
      // needs the drizzle instance passed in (it does not bind it). Parameterize
      // the schema to avoid any injection.
      const result = await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema}`,
      });
      return (result.rows as Array<{ table_name: string }>).map((r) => r.table_name);
    };

    it("creates the cms schema with the old spine and seven v1 main tables", async () => {
      const tables = await tablesIn("cms");
      // Every business collection. cms runs on drizzle push (payload.config.ts:
      // push: true, no checked-in migrations) — so no payload_migrations table
      // (that's a migrate-mode artifact; website keeps its own). customer_addresses
      // was dropped when address became a flat text field on customers.
      expect(tables).toEqual(
        expect.arrayContaining([
          "sellers",
          "operators",
          "customers",
          "offerings",
          "service_slots",
          "orders",
          "order_items",
          "fulfillments",
          "menu_plans",
          "chat_messages",
          "subscriptions",
          ...v1Slugs,
        ]),
      );
    });

    it("does not leak cms tables into the public schema", async () => {
      const publicTables = await tablesIn("public");
      for (const leak of ["sellers", "operators", "offerings"]) {
        expect(publicTables).not.toContain(leak);
      }
      expect(publicTables.some((table) => table.startsWith("kiv1_"))).toBe(false);
    });

    it("does not collide with the website schema's tables", async () => {
      const cmsTables = await tablesIn("cms");
      // website's business tables must not appear under cms.
      for (const websiteTable of ["cms_admins", "site_documents", "recipes"]) {
        expect(cmsTables).not.toContain(websiteTable);
      }
      const websiteTables = await tablesIn("website");
      expect(websiteTables.some((table) => table.startsWith("kiv1_"))).toBe(false);
    });

    it("creates every v1 minimal index through Payload collection indexes", async () => {
      const result = await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`
          SELECT tablename, indexdef FROM pg_indexes
          WHERE schemaname = 'cms' AND tablename IN (
            'kiv1_sellers',
            'kiv1_operators',
            'kiv1_customer_profiles',
            'kiv1_offerings',
            'kiv1_meal_slots',
            'kiv1_booking_batches',
            'kiv1_orders'
          )
        `,
      });
      const byTable = new Map<string, string[]>();
      for (const row of result.rows as Array<{ tablename: string; indexdef: string }>) {
        const definitions = byTable.get(row.tablename) ?? [];
        definitions.push(row.indexdef.toLowerCase().replaceAll('"', "").replace(/\s+/g, " "));
        byTable.set(row.tablename, definitions);
      }
      const hasIndex = (table: string, fields: string[], unique = false): boolean =>
        (byTable.get(table) ?? []).some((definition) =>
          (!unique || definition.startsWith("create unique index")) &&
          definition.includes(`(${fields.join(", ")})`),
        );

      expect(hasIndex("kiv1_operators", ["seller_id", "wechat_openid"], true)).toBe(true);
      expect(hasIndex("kiv1_customer_profiles", ["seller_id", "openid", "active"])).toBe(true);
      expect(hasIndex("kiv1_offerings", ["seller_id", "name"], true)).toBe(true);
      expect(hasIndex("kiv1_offerings", ["seller_id", "active", "category"])).toBe(true);
      expect(hasIndex("kiv1_meal_slots", ["seller_id", "date", "occasion"], true)).toBe(true);
      expect(hasIndex("kiv1_meal_slots", ["seller_id", "order_status"])).toBe(true);
      expect(hasIndex("kiv1_booking_batches", ["public_id"], true)).toBe(true);
      expect(hasIndex("kiv1_booking_batches", ["seller_id", "status"])).toBe(true);
      expect(hasIndex("kiv1_orders", ["seller_id", "meal_slot_id", "customer_profile_id"], true)).toBe(true);
      expect(hasIndex("kiv1_orders", ["seller_id", "meal_slot_id", "status"])).toBe(true);
      expect(hasIndex("kiv1_orders", ["seller_id", "customer_openid"])).toBe(true);
    });

    it("rejects duplicate operator openid within one seller but allows it across sellers", async () => {
      const suffix = crypto.randomUUID();
      const sellerA = await payload.create({
        collection: "kiv1_sellers",
        data: { name: `索引测试 A ${suffix}`, defaultPriceCents: 3000, status: "active" },
        overrideAccess: true,
      });
      const sellerB = await payload.create({
        collection: "kiv1_sellers",
        data: { name: `索引测试 B ${suffix}`, defaultPriceCents: 3000, status: "active" },
        overrideAccess: true,
      });
      const openid = `same-openid-${suffix}`;
      const operatorA = await payload.create({
        collection: "kiv1_operators",
        data: { seller: sellerA.id, wechatOpenid: openid, active: true },
        overrideAccess: true,
      });
      const operatorB = await payload.create({
        collection: "kiv1_operators",
        data: { seller: sellerB.id, wechatOpenid: openid, active: true },
        overrideAccess: true,
      });

      try {
        await expect(payload.create({
          collection: "kiv1_operators",
          data: { seller: sellerA.id, wechatOpenid: openid, active: true },
          overrideAccess: true,
        })).rejects.toThrow();
      } finally {
        await payload.delete({ collection: "kiv1_operators", id: operatorA.id, overrideAccess: true });
        await payload.delete({ collection: "kiv1_operators", id: operatorB.id, overrideAccess: true });
        await payload.delete({ collection: "kiv1_sellers", id: sellerA.id, overrideAccess: true });
        await payload.delete({ collection: "kiv1_sellers", id: sellerB.id, overrideAccess: true });
      }
    });

    it("re-creates partial-unique constraints drizzle push can't express (onInit)", async () => {
      // These three business-critical uniques carry a WHERE clause, so collection
      // `indexes` (no partial-predicate support) won't build them under push.
      // ensurePartialUniqueConstraints (payload onInit) must create them on boot.
      const result = await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`
          SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'cms' AND indexname IN (
            'service_slots_seller_date_occasion_unique',
            'orders_seller_customer_date_occasion_unique',
            'orders_seller_idempotency_key_unique'
          )
          ORDER BY indexname
        `,
      });
      const byName = new Map(
        (result.rows as Array<{ indexname: string; indexdef: string }>).map((r) => [
          r.indexname,
          r.indexdef,
        ]),
      );
      expect(byName.get("service_slots_seller_date_occasion_unique")).toMatch(
        /WHERE .*occasion.*IS NOT NULL/i,
      );
      // Postgres rewrites `status IN ('draft','confirmed')` to
      // `status = ANY (ARRAY['draft'::..., 'confirmed'::...])` in indexdef — match
      // the tokens, not the syntax.
      expect(byName.get("orders_seller_customer_date_occasion_unique")).toMatch(
        /WHERE .*status.*draft.*confirmed/i,
      );
      expect(byName.get("orders_seller_idempotency_key_unique")).toMatch(
        /WHERE .*idempotency_key.*IS NOT NULL/i,
      );
    });

    it("re-creates composite lookup indexes lost to push mode (onInit)", async () => {
      // Non-unique performance indexes from the original migration — kept in the
      // same ensureConstraints helper so all push-bypass indexes live in one place.
      const result = await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = 'cms' AND indexname IN (
            'orders_seller_date_occasion_status_payment_status_idx',
            'orders_seller_customer_status_placed_at_idx',
            'fulfillments_seller_service_date_occasion_status_idx',
            'chat_messages_seller_operator_created_at_idx'
          )
        `,
      });
      const names = (result.rows as Array<{ indexname: string }>).map(
        (r) => r.indexname,
      );
      expect(names).toEqual(
        expect.arrayContaining([
          "orders_seller_date_occasion_status_payment_status_idx",
          "orders_seller_customer_status_placed_at_idx",
          "fulfillments_seller_service_date_occasion_status_idx",
          "chat_messages_seller_operator_created_at_idx",
        ]),
      );
    });

    it("chat_messages.operator_id is NOT NULL (collection required:true)", async () => {
      const result = await payload.db.execute({
        drizzle: payload.db.drizzle,
        sql: sql`
          SELECT is_nullable FROM information_schema.columns
          WHERE table_schema = 'cms' AND table_name = 'chat_messages' AND column_name = 'operator_id'
        `,
      });
      expect((result.rows as Array<{ is_nullable: string }>)[0]?.is_nullable).toBe("NO");
    });
  },
);
