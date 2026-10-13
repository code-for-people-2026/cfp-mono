export {};
// Run with an explicit DB URI, not the application's fallback database.
if (!process.env.HELLO_DATABASE_URI) throw new Error("必须显式选择数据库，默认只预览，不使用本地默认库");
if (process.argv.includes("--apply") && !process.env.HELLO_PRIVACY_DELETION_LEDGER) throw new Error("执行清理前必须配置独立删除清单");
process.env.HELLO_DEPLOYED = "true"; // migrations, never schema push
const { cms } = await import("../src/cms/client");
const { maintainPrivacy } = await import("../src/privacy/maintenance");
const payload = await cms();
try {
  console.log(await maintainPrivacy(payload, { apply: process.argv.includes("--apply"), ...(process.argv.includes("--restore") ? { restoreLedger: process.env.HELLO_PRIVACY_DELETION_LEDGER } : {}) }));
} finally { await payload.destroy(); }
