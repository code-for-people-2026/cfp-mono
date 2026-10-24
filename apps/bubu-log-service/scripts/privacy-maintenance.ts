import { createRuntime } from "../src/runtime";
import { identityDirectory, operationsOrigin } from "../src/runtime-config";
const action = process.argv[2] || "retention", apply = process.argv.includes("--apply");
if (!["retention", "migrate-media", "restore-check"].includes(action)) throw new Error("Expected retention, migrate-media or restore-check; default is dry-run.");
if (action === "restore-check" && !apply) throw new Error("Restore replay needs --apply on an isolated restored directory with its independent current ledger.");
const runtime = await createRuntime({ directory: identityDirectory(), secret: process.env.BUBU_PAYLOAD_SECRET, publicOrigin: process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320", opsOrigin: operationsOrigin(), mcpUrl: "http://127.0.0.1:3320/api/mcp", maintenanceWorker: false });
try {
  if (action === "migrate-media") console.log(JSON.stringify(await runtime.attachments.migrateObjects(apply)));
  else if (action === "restore-check") { await runtime.deletion.replayAfterRestore(); console.log(JSON.stringify({ replayed: true, notice: "Replay succeeded; retain network isolation until schema and media checks also pass." })); }
  else console.log(JSON.stringify({ apply, report: await runtime.maintenance.run(apply) }));
} finally { await runtime.close(); }
