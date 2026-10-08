import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { memorySchema } from "../src/domain/context-policy";

// 在隔离的空库验证正式迁移，绝不对本机现有聊天库启用初始迁移。
const directory = await mkdtemp(path.join(os.tmpdir(), "aj-preview-migration-"));
process.env.HELLO_DEPLOYED = "true";
process.env.HELLO_DATABASE_URI = `file:${directory}/hello.db`;
process.env.PAYLOAD_SECRET = randomBytes(48).toString("hex");
Object.assign(process.env, { NODE_ENV: "production" });
try {
  const { cms } = await import("../src/cms/client");
  const payload = await cms();
  assert.equal((await payload.count({ collection: "sessions", overrideAccess: true })).totalDocs, 0);
  const row = await payload.create({
    collection: "sessions", overrideAccess: true,
    data: { owner: "deployment-test", title: "迁移验收", memory: memorySchema.parse({ revision: 1 }) },
  });
  await payload.db.migrate();
  const saved = await payload.findByID({ collection: "sessions", id: row.id, overrideAccess: true });
  assert.equal(saved.title, "迁移验收");
  assert.deepEqual(saved.memory, memorySchema.parse({ revision: 1 }));
  assert.equal((await payload.count({ collection: "admins", overrideAccess: true })).totalDocs, 0);
  await payload.destroy();
  console.log("空库迁移、重复执行、业务记录和记忆保存通过；本机数据库未改动。");
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.exit(0);
