import { deletionLedgerPath } from "../src/privacy/deletion-ledger";
const ledger = deletionLedgerPath();
// Run with an explicit DB URI, not the application's fallback database.
if (!process.env.HELLO_DATABASE_URI) throw new Error("必须显式选择数据库，默认只预览，不使用本地默认库");
if ((process.argv.includes("--apply") || process.argv.includes("--restore")) && !ledger) throw new Error("执行清理或恢复前必须配置独立删除清单的绝对路径");
process.env.HELLO_DEPLOYED = "true"; // migrations, never schema push
const { cms } = await import("../src/cms/client");
const { maintainPrivacy } = await import("../src/privacy/maintenance");
const payload = await cms();
try {
  console.log(await maintainPrivacy(payload, { apply: process.argv.includes("--apply"), ...(process.argv.includes("--restore") ? { restoreLedger: ledger } : {}) }));
} finally { await payload.destroy(); }
