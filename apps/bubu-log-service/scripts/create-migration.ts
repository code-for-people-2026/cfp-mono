import { privacyCollections } from "../src/privacy/persistence";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig, getPayload } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { collections } from "../src/store";
import { recordCollections } from "../src/records/persistence";
import { chatCollections } from "../src/chat/persistence";
import { membershipCollections } from "../src/membership/persistence";
import { operationsCollections, decorateCollections } from "../src/operations/collections";
const config = await buildConfig({ secret: "schema-generation-only-no-network-no-data", admin: { user: "ops-users" }, collections:[...decorateCollections([...collections,...recordCollections,...chatCollections,...membershipCollections, ...privacyCollections]), ...operationsCollections], typescript: { autoGenerate: false }, telemetry: false,
  db: sqliteAdapter({ client: { url: "file::memory:" }, push: false, transactionOptions: {}, migrationDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/migrations") }) });
const payload = await getPayload({ config, disableDBConnect: true, disableOnInit: true });
await payload.db.createMigration({ migrationName: process.argv[2] || "identity_schema", skipEmpty: true, payload });
process.exit(0);
