import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "@payloadcms/db-sqlite";
import { createLocalReq } from "payload";
const directory = await mkdtemp(path.join(tmpdir(), "aj-image-migration-"));
Object.assign(process.env, { HELLO_DATABASE_URI: `file:${directory}/migration.db`, PAYLOAD_SECRET: "isolated-image-migration", HELLO_DEPLOYED: "true", NODE_ENV: "test" });
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const payload = await cms();
try {
  const db = payload.db.drizzle, req = await createLocalReq({}, payload);
  for (const migration of migrations.filter((item) => !item.name.includes("image_generation"))) await migration.up({ db, payload, req });
  await db.run(sql`INSERT INTO media (owner, mime_type, base64) VALUES ('legacy-owner', 'image/png', 'c3ludGhldGlj')`);
  const migration = migrations.find((item) => item.name.includes("image_generation"))!;
  await migration.up({ db, payload, req }); await migration.up({ db, payload, req });
  const row = (await payload.find({ collection: "media", overrideAccess: true })).docs[0];
  assert.equal(row.base64, "c3ludGhldGlj");
  assert.equal(row.generation, null);
  await payload.update({ collection: "media", id: row.id, overrideAccess: true, data: { generationKey: "legacy-owner:1", generation: { provider: "bailian", turnId: 1, model: "wan2.6-t2i", taskId: "test" } } });
  assert.equal((await db.all<{ integrity_check: string }>(sql`PRAGMA integrity_check`))[0].integrity_check, "ok");
  assert.deepEqual(await db.all(sql`PRAGMA foreign_key_check`), []);
  console.log("✓ 生图迁移重复执行、旧图片保留、新来源字段写入、数据库完整性通过。");
} finally { await payload.destroy(); await rm(directory, { recursive: true, force: true }); }
