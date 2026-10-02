import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getPayload } from "payload";
import { sql, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import * as initial from "../src/cms/migrations/20260930_123608_initial_preview";
import * as images from "../src/cms/migrations/20261002_014226_private_image_objects";

const worker = process.argv[2] === "--migrate-worker";
const dir = worker
  ? process.argv[3]
  : await mkdtemp(path.join(tmpdir(), "hello-image-schema-"));
assert.ok(
  dir && path.basename(dir).startsWith("hello-image-schema-"),
  "只能使用本测试的隔离目录",
);
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "schema-check-not-for-deployment";
process.env.HELLO_DEPLOYED = "true";
// 保留真实应用的数据库适配配置，但由测试显式决定运行哪个迁移。
Object.assign(process.env, { NODE_ENV: "test" });
process.env.PAYLOAD_DROP_DATABASE = "false";
const config = await (await import("../payload.config")).default;
const payload = await getPayload({ config });
const imageMigration = {
  up: (args: unknown) => images.up(args as MigrateUpArgs),
  down: images.down,
  name: "20261002_014226_private_image_objects",
};
try {
  if (worker) {
    // Payload 迁移失败会退出进程；用真实子进程验证退出后数据库的持久状态。
    await payload.db.migrate({ migrations: [imageMigration] });
  } else {
    const db = payload.db.drizzle;
    await payload.db.migrate({
      migrations: [
        {
          up: (args) => initial.up(args as MigrateUpArgs),
          down: (args) => initial.down(args as MigrateUpArgs),
          name: "20260930_123608_initial_preview",
        },
      ],
    });
    await db.run(
      sql`INSERT INTO media (id, owner, mime_type, base64) VALUES (17, 'old-owner', 'image/jpeg', 'b2xkLWltYWdl');`,
    );
    await db.run(sql`INSERT INTO payload_locked_documents (id) VALUES (1);`);
    await db.run(
      sql`INSERT INTO payload_locked_documents_rels (id, parent_id, path, media_id) VALUES (1, 1, 'document', 17);`,
    );
    const previousColumns = await db.all(sql`PRAGMA table_info(media);`);
    const previousImage = await db.get(sql`SELECT * FROM media WHERE id=17;`);
    const previousRelations = await db.all(
      sql`SELECT * FROM payload_locked_documents_rels;`,
    );
    const previousMigrations = await payload.find({
      collection: "payload-migrations",
      depth: 0,
      pagination: false,
    });

    // 由真实 SQLite 在复制旧内容时拒绝写入，此时迁移已经执行了两条 ADD COLUMN。
    await db.run(sql`CREATE TRIGGER fail_image_copy BEFORE UPDATE ON media
    BEGIN SELECT RAISE(ABORT, 'injected-image-copy-failure'); END;`);
    let failureOutput = "";
    try {
      await promisify(execFile)(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(import.meta.url),
          "--migrate-worker",
          dir,
        ],
        { timeout: 45_000 },
      );
      assert.fail("注入数据库故障后迁移必须失败退出");
    } catch (error) {
      assert.ok(
        error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 1,
        "必须是迁移失败，不是超时或进程被杀",
      );
      failureOutput =
        String("stdout" in error ? error.stdout : "") +
        String("stderr" in error ? error.stderr : "");
      assert.match(failureOutput, /injected-image-copy-failure/);
    }
    assert.deepEqual(
      await db.all(sql`PRAGMA table_info(media);`),
      previousColumns,
      "失败退出后不得留下新增列或半迁移结构",
    );
    assert.deepEqual(
      await db.get(sql`SELECT * FROM media WHERE id=17;`),
      previousImage,
      "旧图片内容与属性必须保持不变",
    );
    assert.deepEqual(
      await db.all(sql`SELECT * FROM payload_locked_documents_rels;`),
      previousRelations,
    );
    assert.deepEqual(
      (
        await payload.find({
          collection: "payload-migrations",
          depth: 0,
          pagination: false,
        })
      ).docs,
      previousMigrations.docs,
      "失败迁移不得记录为已完成",
    );
    await db.run(sql`DROP TRIGGER fail_image_copy;`);
    console.log(
      "✓ 表结构迁移中途失败并退出后，结构、图片、外键关系和迁移记录全部回滚",
    );

    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        "--migrate-worker",
        dir,
      ],
      { timeout: 45_000 },
    );
    // 重新通过 Local API 按字段读取；不复用另一进程修改结构前缓存的 SELECT * 列映射。
    const record = await payload.findByID({
      collection: "media",
      id: 17,
      depth: 0,
    });
    assert.equal(record.base64, "b2xkLWltYWdl");
    assert.equal(record.owner, "old-owner");
    assert.equal(record.object, null);
    assert.equal(
      (
        await db.get<Record<string, unknown>>(
          sql`SELECT media_id FROM payload_locked_documents_rels WHERE id=1;`,
        )
      ).media_id,
      17,
    );
    await payload.update({
      collection: "media",
      id: 17,
      data: { base64: null, object: {} },
    });
    assert.equal(
      (await payload.findByID({ collection: "media", id: 17 })).base64,
      null,
    );
    assert.equal((await db.all(sql`PRAGMA foreign_key_check;`)).length, 0);
    await assert.rejects(() => images.down(), /不能盲目/);
    const completed = await payload.find({
      collection: "payload-migrations",
      where: { name: { equals: imageMigration.name } },
      depth: 0,
    });
    assert.equal(completed.totalDocs, 1);
    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        "--migrate-worker",
        dir,
      ],
      { timeout: 45_000 },
    );
    assert.equal(
      (
        await payload.find({
          collection: "payload-migrations",
          where: { name: { equals: imageMigration.name } },
        })
      ).totalDocs,
      1,
    );
    console.log(
      "✓ 同名迁移可重试成功且不会重复执行；内容、ID、归属与外键保留；拒绝危险逆迁移",
    );
  }
} finally {
  await payload.destroy();
}
