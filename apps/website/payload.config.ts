import { postgresAdapter } from "@payloadcms/db-postgres";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";
import { CMSAdmins } from "./src/payload/collections/CMSAdmins";
import { FormLinks } from "./src/payload/collections/FormLinks";
import { MatrixSubmissions } from "./src/payload/collections/MatrixSubmissions";
import { Recipes } from "./src/payload/collections/Recipes";
import { SiteDocuments } from "./src/payload/collections/SiteDocuments";
import { SiteContent } from "./src/payload/globals/SiteContent";
import { migrations } from "./src/payload/migrations";

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

// website 与 apps/site 共用同一个 Postgres 库（cfp）。两个 Payload 应用都在管理各自的
// schema，若同处 public 会互相覆盖建表，因此把 website 隔离到独立 schema。
// 固定为 "website"：生成的 migration 把 schema 名字面量地写死进了建表 SQL，做成 env 可覆盖
// 只会让“配置的 schema”和“migration 实际建表的 schema”不一致（换个值就 /admin 缺表）。
// apps/site 仍用默认的 public。
const schemaName = "website";

const db = postgresDatabaseURL
  ? postgresAdapter({
      pool: {
        connectionString: postgresDatabaseURL,
      },
      schemaName,
      migrationDir: "src/payload/migrations",
      // In production the adapter never runs `push`; instead it auto-applies these
      // migrations on connect (creates the website schema + tables on first boot, then
      // no-ops once recorded in payload_migrations). So a deploy needs no separate
      // `payload migrate` step. In dev, `push` (PAYLOAD_DB_PUSH=true) still applies.
      prodMigrations: migrations,
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
  collections: [CMSAdmins, SiteDocuments, FormLinks, MatrixSubmissions, Recipes],
  globals: [SiteContent],
  // We hand-write the content shapes in src/lib/content/types.ts and intentionally do not
  // ship a generated payload-types.ts. Disable auto-generation so the Payload CLI (e.g.
  // migrate:create) doesn't emit one whose `declare module 'payload'` augmentation would
  // make getPayload() strict and break the `as Raw` mapping in the content layer.
  typescript: {
    autoGenerate: false,
  },
});
