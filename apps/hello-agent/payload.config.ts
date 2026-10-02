import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";
import { zh } from "payload/i18n/zh";
import { collections } from "./src/cms/collections";
import { migrations } from "./src/cms/migrations";

// 检查工具可能从仓库根目录加载配置，数据位置不能随进程工作目录变化。
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".data");
const deployed = process.env.HELLO_DEPLOYED === "true";
if (deployed && (!process.env.PAYLOAD_SECRET || !process.env.HELLO_DATABASE_URI)) {
  throw new Error("远程部署必须显式配置 CMS 密钥和独立数据库位置");
}
mkdirSync(dataDir, { recursive: true });
const secretPath = path.join(dataDir, "secret");
// 本地首次运行生成稳定密钥，重启后仍能验证 CMS 会话；部署时必须显式配置。
if (!process.env.PAYLOAD_SECRET && !existsSync(secretPath)) {
  try {
    writeFileSync(secretPath, randomBytes(48).toString("hex"), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!existsSync(secretPath)) throw error;
  }
}

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || readFileSync(secretPath, "utf8"),
  db: sqliteAdapter({
    client: {
      url: process.env.HELLO_DATABASE_URI || `file:${dataDir}/hello.db`,
    },
    // SQLite 适配器默认不开事务；显式启用，让迁移及单次 Local API 写入失败时回滚。
    // OSS 网络请求不属于数据库事务，也不应持有数据库写锁等待网络。
    transactionOptions: {},
    push: !deployed,
    migrationDir: path.resolve(dataDir, "../src/cms/migrations"),
    prodMigrations: deployed ? migrations : undefined,
  }),
  collections,
  i18n: { supportedLanguages: { zh }, fallbackLanguage: "zh" },
  admin: { user: "admins", importMap: { autoGenerate: false } },
  typescript: { autoGenerate: false },
});
