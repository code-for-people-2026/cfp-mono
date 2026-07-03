import { postgresAdapter } from "@payloadcms/db-postgres";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";
import { collections } from "@cfp/kith-inn-payload";

// Auto-load .env (Node 24 native process.loadEnvFile — no new dep). next dev
// loads .env itself, but tsx entry points (seed/run.ts, etc.) don't, so without
// this `pnpm seed` falls back to sqlite (wrong DB) while cms dev uses Postgres.
// Runs before the env reads below; no-op if .env absent (prod — runtime env).
try {
  process.loadEnvFile();
} catch {
  /* no .env in cwd — rely on runtime env */
}

const requiresProductionEnv =
  process.env.VERCEL === "1" || process.env.VERCEL === "true";

const postgresDatabaseURL =
  process.env.PAYLOAD_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  (process.env.DATABASE_URI?.startsWith("postgres") ? process.env.DATABASE_URI : undefined);

const payloadSecret = process.env.PAYLOAD_SECRET;

if (requiresProductionEnv && !payloadSecret) {
  throw new Error("PAYLOAD_SECRET is required for Vercel deployments.");
}

if (requiresProductionEnv && !postgresDatabaseURL) {
  throw new Error("A Postgres database URL is required for Vercel Payload deployments.");
}

// apps/cms is the SHARED Payload host for kith-inn and future small apps. It
// shares the SAME Postgres instance as apps/website but is isolated to its own
// schema "cms" (website stays untouched on "website"). Each app's collections
// live in their own package (kith-inn → @cfp/kith-inn-payload) and are aggregated
// here — this host ships no business collections of its own. Like website's
// schema, "cms" is a literal: drizzle push bakes it into every CREATE TABLE,
// so making it env-configurable would desync config from the pushed schema.
const schemaName = "cms";

const db = postgresDatabaseURL
  ? postgresAdapter({
      pool: {
        connectionString: postgresDatabaseURL,
      },
      schemaName,
      // Undeployed + no prod data: collection definitions ARE the source of truth,
      // synced to the DB via drizzle push. No checked-in migrations to maintain
      // (pure burden pre-deploy — feature 001 alone spawned docs debt, dev drift,
      // and a migrate runner that won't run on a push-built DB). To switch: run
      // `payload migrate:create` for a baseline once real data exists worth
      // preserving; partial-unique constraints Payload can't express stay as SQL.
      push: true,
    })
  : sqliteAdapter({
      client: {
        url: process.env.DATABASE_URI || "file:./payload.db",
      },
    });

export default buildConfig({
  secret: payloadSecret || "code-for-people-dev-secret-change-me",
  db,
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
  collections,
  typescript: {
    autoGenerate: false,
  },
});
