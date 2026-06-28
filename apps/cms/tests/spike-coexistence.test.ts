import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "@payloadcms/db-postgres";
import { getPayload } from "payload";
import type { Payload } from "payload";
import config from "../payload.config";

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

    it("creates the cms schema with the full kith-inn spine", async () => {
      const tables = await tablesIn("cms");
      // Every business collection (PR3) + Payload's migrations bookkeeping.
      expect(tables).toEqual(
        expect.arrayContaining([
          "sellers",
          "operators",
          "customers",
          "customer_addresses",
          "offerings",
          "service_slots",
          "orders",
          "order_items",
          "fulfillments",
          "menu_plans",
          "chat_messages",
          "subscriptions",
          "payload_migrations",
        ]),
      );
    });

    it("does not leak cms tables into the public schema", async () => {
      const publicTables = await tablesIn("public");
      for (const leak of ["sellers", "operators", "offerings"]) {
        expect(publicTables).not.toContain(leak);
      }
    });

    it("does not collide with the website schema's tables", async () => {
      const cmsTables = await tablesIn("cms");
      // website's business tables must not appear under cms.
      for (const websiteTable of ["cms_admins", "site_documents", "recipes"]) {
        expect(cmsTables).not.toContain(websiteTable);
      }
    });
  },
);
