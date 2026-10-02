import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const uri =
  process.env.HELLO_DATABASE_URI ||
  `file:${path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.data/hello.db")}`;
if (!uri.startsWith("file:") || uri.includes("?")) {
  throw new Error(
    "本地初始化仅接受 file: SQLite 数据库；远程或生产数据库请使用正式迁移",
  );
}
let exists = false;
try {
  exists = (await stat(uri.slice(5))).size > 0;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (exists) {
  console.log("已有本地数据库，不自动改写其结构。");
} else {
  // 只为新的本地演示库建表。Payload 在生产运行时不会自动 push schema。
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "空库尚未初始化：本地请先以开发环境运行 db:init；正式部署必须使用迁移",
    );
  }
  const { cms } = await import("../src/cms/client");
  const payload = await cms();
  await payload.destroy();
  console.log("已初始化独立的本地演示数据库；未创建管理员或业务数据。");
}
import "./load-local-env";
