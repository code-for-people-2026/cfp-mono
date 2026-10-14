import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`platform_model_quotas\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`day\` text NOT NULL,
  	\`reserved_calls\` numeric NOT NULL
  );
  `);
  await db.run(
    sql`CREATE UNIQUE INDEX \`platform_model_quotas_day_idx\` ON \`platform_model_quotas\` (\`day\`);`,
  );
}

export async function down(): Promise<void> {
  throw new Error(
    "不能自动删除已预扣的平台模型额度；请停止写入并按备份恢复流程回退。",
  );
}
