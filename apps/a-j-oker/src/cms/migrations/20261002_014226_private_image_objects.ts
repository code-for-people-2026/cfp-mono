import { type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // 保留 media 表本身，避免重建表时触发后台文档关系的级联删除。
  // 经应用已启用事务的 Payload 迁移入口执行；不能直接调用 up 冒充事务保护。
  // 旧内容完整复制后才替换非空约束列；保留已发布迁移的名称和 SQL。
  await db.run(sql`ALTER TABLE media ADD COLUMN object text;`);
  await db.run(sql`ALTER TABLE media ADD COLUMN migrated_base64 text;`);
  await db.run(sql`UPDATE media SET migrated_base64 = base64;`);
  await db.run(sql`ALTER TABLE media DROP COLUMN base64;`);
  await db.run(sql`ALTER TABLE media RENAME COLUMN migrated_base64 TO base64;`);
}

export async function down(): Promise<void> {
  throw new Error("图片已支持 OSS 引用，不能盲目删列回退；请停止写入后按备份恢复流程处理。");
}
