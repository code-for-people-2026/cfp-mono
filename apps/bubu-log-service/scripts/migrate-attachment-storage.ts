import path from "node:path";
import { pathToFileURL } from "node:url";
import { AppError } from "../src/contracts";
import { createRuntime } from "../src/runtime";
import { identityDirectory, operationsOrigin } from "../src/runtime-config";

const apply = process.argv.includes("--apply");
const removeLocal = process.argv.includes("--remove-local");
const unexpected = process.argv.slice(2).filter(argument => argument !== "--apply" && argument !== "--remove-local");
if (unexpected.length) throw new Error("Expected only --apply and --remove-local");
if (removeLocal && !apply) throw new Error("--remove-local requires --apply");

async function main() {
  const runtime = await createRuntime({
    directory: identityDirectory(),
    secret: process.env.BUBU_PAYLOAD_SECRET,
    publicOrigin: process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320",
    opsOrigin: operationsOrigin(),
    mcpUrl: "http://127.0.0.1:3320/api/mcp",
    maintenanceWorker: false,
  });
  try {
    const report = await runtime.attachments.migrateAttachmentStorage({ apply, removeLocal });
    console.log(JSON.stringify(report));
  } finally {
    await runtime.close();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  await main().catch(error => {
    // Keep provider diagnostics, object keys, image metadata and secrets out of operator logs.
    const code = error instanceof AppError ? error.code : "ATTACHMENT_STORAGE_MIGRATION_FAILED";
    console.log(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  });
}
