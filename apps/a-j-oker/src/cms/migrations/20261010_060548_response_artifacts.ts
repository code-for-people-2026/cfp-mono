import { type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`greetings\` ADD \`approach\` text;`)
  await db.run(sql`ALTER TABLE \`greetings\` ADD \`artifacts\` text;`)
}

export async function down(): Promise<void> {
  throw new Error("回应作品已持久化，不能自动删列；请停止写入并按备份恢复流程回退。");
}
