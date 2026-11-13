import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Existing profiles must inspect legacy input once before caching a result.
  await db.run(sql`ALTER TABLE privacy_profiles ADD COLUMN history_inspected integer DEFAULT false`);
}
export async function down(): Promise<void> {
  throw new Error("历史检查状态需与授权版本一同保留，请使用备份恢复流程。");
}
