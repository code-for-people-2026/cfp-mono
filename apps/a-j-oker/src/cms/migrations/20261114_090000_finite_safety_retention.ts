import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(safety_cases)`);
  for (const [name, type] of [
    ["retention_review_needed", "integer DEFAULT 0"],
    ["retention_purged_at", "text"],
    ["hold_review_at", "text"],
  ]) if (!columns.some((column) => column.name === name)) await db.run(sql.raw(`ALTER TABLE safety_cases ADD COLUMN ${name} ${type}`));
  await db.run(sql`CREATE INDEX IF NOT EXISTS safety_cases_retention_review_needed_idx ON safety_cases(retention_review_needed)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS safety_cases_retention_purged_at_idx ON safety_cases(retention_purged_at)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS safety_cases_hold_review_at_idx ON safety_cases(hold_review_at)`);
}

export async function down(): Promise<void> {
  throw new Error("留存审查与内容清理标记不可在未归档审计证据时直接移除。");
}
