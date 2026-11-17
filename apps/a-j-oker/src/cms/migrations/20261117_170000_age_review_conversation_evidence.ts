import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(safety_evidence)`);
  if (!columns.some(column => column.name === "provenance"))
    await db.run(sql`ALTER TABLE safety_evidence ADD COLUMN provenance text`);
  if (!columns.some(column => column.name === "conversation"))
    await db.run(sql`ALTER TABLE safety_evidence ADD COLUMN conversation text`);
}

export async function down(): Promise<void> {
  throw new Error("年龄复核对话证据属于受控安全记录，不能自动删除；请先执行留存与数据权利评估。");
}
