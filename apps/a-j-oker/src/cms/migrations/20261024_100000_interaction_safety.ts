import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(age_profiles)`);
  if (!columns.some(({ name }) => name === "interaction")) await db.run(sql`ALTER TABLE age_profiles ADD COLUMN interaction text`);
}
export async function down(): Promise<void> { throw new Error("紧急联系人及安全状态须先完成数据迁移，不能直接移除字段。"); }
