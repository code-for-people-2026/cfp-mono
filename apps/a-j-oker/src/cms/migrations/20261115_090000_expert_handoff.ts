import { sql } from "@payloadcms/db-sqlite";
import type { MigrateUpArgs } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`agent_configs\` ADD \`theme\` text;`);
  await db.run(sql`ALTER TABLE \`agent_configs\` ADD \`preferred_layout\` text;`);
  await db.run(sql`CREATE TABLE \`agent_configs_allowed_components\` (
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`value\` text,
    \`id\` integer PRIMARY KEY NOT NULL,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`agent_configs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`);
  await db.run(sql`CREATE INDEX \`agent_configs_allowed_components_order_idx\` ON \`agent_configs_allowed_components\` (\`order\`);`);
  await db.run(sql`CREATE INDEX \`agent_configs_allowed_components_parent_idx\` ON \`agent_configs_allowed_components\` (\`parent_id\`);`);
  await db.run(sql`CREATE TABLE \`agent_configs_preferred_components\` (
    \`order\` integer NOT NULL,
    \`parent_id\` integer NOT NULL,
    \`value\` text,
    \`id\` integer PRIMARY KEY NOT NULL,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`agent_configs\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );`);
  await db.run(sql`CREATE INDEX \`agent_configs_preferred_components_order_idx\` ON \`agent_configs_preferred_components\` (\`order\`);`);
  await db.run(sql`CREATE INDEX \`agent_configs_preferred_components_parent_idx\` ON \`agent_configs_preferred_components\` (\`parent_id\`);`);

  // These rows predate presentation settings, so assigning each registered key's
  // native defaults cannot overwrite an administrator's deliberate choice.
  await db.run(sql`UPDATE \`agent_configs\` SET
    \`theme\` = CASE \`key\`
      WHEN 'cbt' THEN 'blue' WHEN 'behavioral' THEN 'blue'
      WHEN 'act' THEN 'plum' WHEN 'self_compassion' THEN 'plum'
      WHEN 'dbt' THEN 'amber' WHEN 'solution_focused' THEN 'amber'
      ELSE 'sage' END,
    \`preferred_layout\` = CASE \`key\`
      WHEN 'cbt' THEN 'step_by_step' WHEN 'dbt' THEN 'step_by_step'
      WHEN 'solution_focused' THEN 'step_by_step'
      WHEN 'behavioral' THEN 'action_plan' WHEN 'positive_psychology' THEN 'action_plan'
      ELSE 'reflection' END;`);

  await db.run(sql`INSERT INTO \`agent_configs_allowed_components\` (\`order\`, \`parent_id\`, \`value\`)
    SELECT 0, \`id\`, 'form' FROM \`agent_configs\` WHERE \`key\` != 'coordinator';`);
  await db.run(sql`INSERT INTO \`agent_configs_allowed_components\` (\`order\`, \`parent_id\`, \`value\`)
    SELECT 1, \`id\`, 'card'
    FROM \`agent_configs\` WHERE \`key\` != 'coordinator';`);
  await db.run(sql`INSERT INTO \`agent_configs_allowed_components\` (\`order\`, \`parent_id\`, \`value\`)
    SELECT 2, \`id\`, 'table' FROM \`agent_configs\` WHERE \`key\` IN ('cbt', 'behavioral');`);
  await db.run(sql`INSERT INTO \`agent_configs_allowed_components\` (\`order\`, \`parent_id\`, \`value\`)
    SELECT CASE
      WHEN \`key\` IN ('cbt', 'behavioral') THEN 3 ELSE 2 END, \`id\`, 'page'
    FROM \`agent_configs\` WHERE \`key\` != 'coordinator';`);

  await db.run(sql`INSERT INTO \`agent_configs_preferred_components\` (\`order\`, \`parent_id\`, \`value\`)
    SELECT 0, \`id\`, 'form' FROM \`agent_configs\`
    WHERE \`key\` IN ('cbt', 'behavioral', 'solution_focused');`);
  await db.run(sql`INSERT INTO \`agent_configs_preferred_components\` (\`order\`, \`parent_id\`, \`value\`)
    SELECT 0, \`id\`, 'card' FROM \`agent_configs\`
    WHERE \`key\` IN ('act', 'dbt', 'positive_psychology');`);
  await db.run(sql`ALTER TABLE \`greetings\` ADD \`specialist\` text;`);
}

export async function down(): Promise<void> {
  throw new Error(
    "专家任务快照和管理员展示配置不可自动回退；请先完成备份并制定数据转换方案。",
  );
}
