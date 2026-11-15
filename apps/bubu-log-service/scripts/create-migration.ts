import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig, getPayload } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { collections } from "../src/store";
import { recordCollections } from "../src/records/persistence";
import { chatCollections } from "../src/chat/persistence";
const config = await buildConfig({ secret: "schema-generation-only-no-network-no-data", collections:[...collections,...recordCollections,...chatCollections], typescript: { autoGenerate: false }, telemetry: false,
  db: sqliteAdapter({ client: { url: "file::memory:" }, push: false, transactionOptions: {}, migrationDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/migrations") }) });
const payload = await getPayload({ config, disableDBConnect: true, disableOnInit: true });
await payload.db.createMigration({ migrationName: process.argv[2] || "identity_schema", skipEmpty: true, payload });
process.exit(0);
