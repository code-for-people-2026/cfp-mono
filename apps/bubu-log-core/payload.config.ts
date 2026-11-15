import { postgresAdapter } from "@payloadcms/db-postgres";
import { buildConfig } from "payload";
import { AppUsers } from "./src/payload/collections/AppUsers";
import { Activities } from "./src/payload/collections/Activities";
import { AuditLogs } from "./src/payload/collections/AuditLogs";
import { Babies } from "./src/payload/collections/Babies";
import { BabyUsers } from "./src/payload/collections/BabyUsers";
import { CMSAdmins } from "./src/payload/collections/CMSAdmins";
import { DailyStats } from "./src/payload/collections/DailyStats";
// This app consumes a verified restore of the original schema. Runtime must never push schema.
export default buildConfig({
  secret: process.env.BUBU_CORE_PAYLOAD_SECRET || "build-only-core-secret-not-for-runtime",
  db: postgresAdapter({ pool: { connectionString: process.env.BUBU_CORE_DATABASE_URL, max: 4 }, push: false }),
  admin: { user: "cms-admins", disable: true, importMap: { autoGenerate: false } },
  graphQL: { disable: true }, telemetry: false,
  collections: [CMSAdmins, AppUsers, Babies, BabyUsers, Activities, DailyStats, AuditLogs],
});
