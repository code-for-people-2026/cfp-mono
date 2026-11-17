import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(
    sql`PRAGMA table_info(agent_configs)`,
  );
  if (!columns.some(({ name }) => name === "subtitle")) {
    await db.run(sql`ALTER TABLE \`agent_configs\` ADD \`subtitle\` text`);
  }
}

export async function down(): Promise<void> {
  throw new Error("专家副标题配置不能自动丢弃；请先备份并制定回退方案。");
}
