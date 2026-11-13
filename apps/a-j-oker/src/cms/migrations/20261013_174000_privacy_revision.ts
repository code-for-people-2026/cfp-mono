import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE privacy_profiles ADD COLUMN revision integer NOT NULL DEFAULT 0`);
}
export async function down(): Promise<void> {
  throw new Error("授权版本用于并发保护，不可在旧请求仍可能运行时移除。");
}
