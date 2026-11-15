import { deletionLedgerPath } from "../src/privacy/deletion-ledger";
const ledger = deletionLedgerPath();
const apply = process.argv.includes("--apply");
const restore = process.argv.includes("--restore");
const applySafetyRetention = process.argv.includes("--apply-safety-retention");
// Run with an explicit DB URI, not the application's fallback database.
if (!process.env.HELLO_DATABASE_URI) throw new Error("必须显式选择数据库，默认只预览，不使用本地默认库");
if ((restore || applySafetyRetention) && !apply) throw new Error("--restore 和 --apply-safety-retention 必须与 --apply 同时使用");
if ((apply || restore) && !ledger) throw new Error("执行清理或恢复前必须配置独立删除清单的绝对路径");
process.env.HELLO_DEPLOYED = "true"; // migrations, never schema push
const { cms } = await import("../src/cms/client");
const { maintainPrivacy } = await import("../src/privacy/maintenance");
const payload = await cms();
try {
  const result = await maintainPrivacy(payload, {
    apply, safetyRetention: true,
    applySafetyRetention: restore || applySafetyRetention,
    ...(restore ? { restoreLedger: ledger } : {}),
  });
  console.log(`HELLO_PRIVACY_MAINTENANCE_RESULT ${JSON.stringify(result)}`);
} finally { await payload.destroy(); }
