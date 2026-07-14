import { postgresAdapter } from "@payloadcms/db-postgres";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";
import { resolve } from "node:path";
import { collections as kithInnCollections } from "@cfp/kith-inn-payload";
import { collections as kithInnV1Collections } from "@cfp/kith-inn-v1-payload";
import { assertCmsProductionEnv } from "./src/config/production";
import { ensureConstraints } from "./src/db/ensureConstraints";
import { assertProductionMigrationCommand } from "./src/db/migrationHead";

// Auto-load .env (Node 24 native process.loadEnvFile — no new dep). next dev
// loads .env itself, but tsx entry points (seed/run.ts, etc.) don't, so without
// this `pnpm seed` falls back to sqlite (wrong DB) while cms dev uses Postgres.
// Runs before the env reads below; no-op if .env absent (prod — runtime env).
try {
  process.loadEnvFile();
} catch {
  /* no .env in cwd — rely on runtime env */
}

assertProductionMigrationCommand();

// Next evaluates route modules while building; runtime config must still fail
// before serving, while build-time image creation remains secret-free.
if (process.env.NEXT_PHASE !== "phase-production-build") assertCmsProductionEnv();

const postgresDatabaseURL =
  process.env.PAYLOAD_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  (process.env.DATABASE_URI?.startsWith("postgres") ? process.env.DATABASE_URI : undefined);

const payloadSecret = process.env.PAYLOAD_SECRET;

// apps/cms is the SHARED Payload host for kith-inn and future small apps. It
// shares the SAME Postgres instance as apps/website but is isolated to its own
// schema "cms" (website stays untouched on "website"). Each app's collections
// live in their own package (kith-inn → @cfp/kith-inn-payload) and are aggregated
// here — this host ships no business collections of its own. Like website's
// schema, "cms" is a literal: drizzle push bakes it into every CREATE TABLE,
// so making it env-configurable would desync config from the pushed schema.
export const schemaName = "cms";

const db = postgresDatabaseURL
  ? postgresAdapter({
      pool: {
        connectionString: postgresDatabaseURL,
      },
      schemaName,
      // Package scripts run with apps/cms as cwd. Avoid a bundled cross-realm
      // URL here: Node's URL path conversion rejects that instance in CI.
      migrationDir: resolve(process.cwd(), "migrations"),
      // Local development keeps Payload's convenient schema push. Production is
      // advanced only by the checked-in, deploy-time migration command.
      push: process.env.NODE_ENV !== "production",
    })
  : sqliteAdapter({
      client: {
        url: process.env.DATABASE_URI || "file:./payload.db",
      },
      // Payload disables SQLite transactions unless this is set. Use an
      // immediate write lock so the order lifecycle keeps the same atomic
      // semantics as Postgres in local fallback mode.
      transactionOptions: { behavior: "immediate" },
    });

export default buildConfig({
  secret: payloadSecret || "code-for-people-dev-secret-change-me",
  db,
  // Re-create custom indexes idempotently after local push and runtime startup.
  onInit: ensureConstraints,
  admin: {
    user: "operators",
    importMap: {
      autoGenerate: false,
    },
  },
  // Collections are aggregated from per-app packages (kith-inn's live in
  // @cfp/kith-inn-payload). We hand-write shapes and ship no generated
  // payload-types.ts (mirrors apps/website); `req.user` stays loosely typed and
  // is narrowed at use sites via isOperator/isAuthorizedOperator.
  collections: [...kithInnCollections, ...kithInnV1Collections],
  typescript: {
    autoGenerate: false,
  },
});
