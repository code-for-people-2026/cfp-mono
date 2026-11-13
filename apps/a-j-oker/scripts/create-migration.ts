import { getPayload } from "payload";
import config from "../payload.config";

// 通过 ESM 入口生成迁移，避开 CLI 二次加载 TypeScript 的命名空间冲突。
const payload = await getPayload({ config, disableDBConnect: true, disableOnInit: true });
await payload.db.createMigration({
  migrationName: process.argv[2] || "schema_change",
  skipEmpty: true,
  payload,
});
// 此入口未建立连接，destroy 会等待不存在的数据库初始化；仅成功后退出。
process.exit(0);
