import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(age_profiles)`);
  if (!columns.some(({ name }) => name === "challenge_purpose")) await db.run(sql`ALTER TABLE age_profiles ADD COLUMN challenge_purpose text`);
}
export async function down(): Promise<void> {
  throw new Error("先停用年龄核验并处理未完成请求，不能直接移除核验用途。");
}
