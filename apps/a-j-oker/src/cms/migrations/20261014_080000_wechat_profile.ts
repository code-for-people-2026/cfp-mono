import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(wechat_identities)`);
  if (!columns.some(({ name }) => name === "profile")) await db.run(sql`ALTER TABLE wechat_identities ADD COLUMN profile text`);
}
export async function down(): Promise<void> {
  throw new Error("个人资料需先完成导出或删除，不能直接移除字段。");
}
