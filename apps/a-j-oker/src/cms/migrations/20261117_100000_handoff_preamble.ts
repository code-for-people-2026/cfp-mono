import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(
    sql`PRAGMA table_info(greetings)`,
  );
  if (!columns.some((column) => column.name === "handoff_preamble")) {
    await db.run(sql`ALTER TABLE greetings ADD COLUMN handoff_preamble text`);
  }
}

export async function down(): Promise<void> {
  throw new Error(
    "已保存的专家交接前导是用户聊天记录，不能自动丢弃；请先完成备份并制定数据转换方案。",
  );
}
