import { DatabaseSync, backup } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// 仅用于已有本地演示库的增量迁移，不运行 schema push，不删除任何字段或记录。
const uri =
  process.env.HELLO_DATABASE_URI ||
  `file:${path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data/hello.db")}`;
if (!uri.startsWith("file:") || uri.includes("?"))
  throw new Error("仅支持本地 SQLite 演示库");
const databasePath = uri.slice(5);
if (!existsSync(databasePath))
  throw new Error("数据库不存在，请先运行 db:init");
const db = new DatabaseSync(databasePath);
try {
  const columns = db.prepare("PRAGMA table_info(sessions)").all();
  if (!columns.length)
    throw new Error("缺少 sessions 表，不对未知数据库进行迁移");
  if (columns.some((column) => column.name === "memory"))
    console.log("对话记忆字段已经存在，无须迁移。");
  else {
    const target = `${databasePath}.before-memory-${Date.now()}.bak`;
    await backup(db, target);
    db.exec(
      "BEGIN IMMEDIATE; ALTER TABLE sessions ADD COLUMN memory text; COMMIT;",
    );
    console.log(
      `已备份至 ${target}，仅新增 sessions.memory；原记录与管理员不变。`,
    );
  }
} finally {
  db.close();
}
