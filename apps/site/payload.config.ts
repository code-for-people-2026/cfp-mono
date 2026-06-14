import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";
import { CMSAdmins } from "./src/payload/collections/CMSAdmins";
import { MiniappDemoEntries } from "./src/payload/collections/MiniappDemoEntries";
import { Pages } from "./src/payload/collections/Pages";

const databaseURL =
  process.env.PAYLOAD_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54324/cfp";

const payloadSecret =
  process.env.PAYLOAD_SECRET || "cfp-site-dev-secret-change-me";

const allowSchemaPush = process.env.PAYLOAD_DB_PUSH === "true";

export default buildConfig({
  secret: payloadSecret,
  db: postgresAdapter({
    pool: {
      connectionString: databaseURL
    },
    push: allowSchemaPush
  }),
  admin: {
    user: "cms-admins",
    importMap: {
      autoGenerate: false
    }
  },
  collections: [CMSAdmins, Pages, MiniappDemoEntries]
});

