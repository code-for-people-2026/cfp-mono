import { postgresAdapter } from "@payloadcms/db-postgres";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";
import { CMSAdmins } from "./src/payload/collections/CMSAdmins";
import { FormLinks } from "./src/payload/collections/FormLinks";
import { SiteDocuments } from "./src/payload/collections/SiteDocuments";

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

const db = postgresDatabaseURL
  ? postgresAdapter({
      pool: {
        connectionString: postgresDatabaseURL,
      },
      migrationDir: "src/payload/migrations",
      push: process.env.PAYLOAD_DB_PUSH === "true",
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
    user: "cms-admins",
    importMap: {
      autoGenerate: false,
    },
  },
  collections: [CMSAdmins, SiteDocuments, FormLinks],
});
