import { type MigrateUpArgs, sql } from '@payloadcms/db-sqlite';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_audit\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`actor\` text NOT NULL,
	\`event\` text NOT NULL,
	\`target\` text NOT NULL,
	\`reason\` text NOT NULL,
	\`metadata\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_cases\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`receipt\` text NOT NULL,
	\`owner\` text NOT NULL,
	\`source\` text NOT NULL,
	\`status\` text NOT NULL,
	\`severity\` text NOT NULL,
	\`category\` text NOT NULL,
	\`stage\` text NOT NULL,
	\`session_id\` numeric,
	\`turn_id\` numeric,
	\`media_id\` numeric,
	\`request_id\` text,
	\`parent_id\` numeric,
	\`assigned_to\` numeric,
	\`last_reviewer\` numeric,
	\`revision\` numeric DEFAULT 0 NOT NULL,
	\`accept_by\` text,
	\`resolve_by\` text,
	\`feedback_by\` text,
	\`accepted_at\` text,
	\`resolved_at\` text,
	\`feedback_at\` text,
	\`rule_version\` text,
	\`lexicon_version\` text,
	\`model_version\` text,
	\`decision\` text,
	\`action\` text,
	\`reason\` text,
	\`reply\` text,
	\`retention_basis\` text,
	\`retain_until\` text,
	\`legal_hold\` integer DEFAULT false,
	\`hold_reason\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_enforcements\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`key\` text NOT NULL,
	\`owner\` text NOT NULL,
	\`target_type\` text NOT NULL,
	\`target_id\` numeric,
	\`session_id\` numeric,
	\`case_id\` numeric NOT NULL,
	\`active\` integer DEFAULT false NOT NULL,
	\`reason\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_evaluation_items\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`suite\` text NOT NULL,
	\`key\` text NOT NULL,
	\`category\` text NOT NULL,
	\`input\` text NOT NULL,
	\`expected\` text NOT NULL,
	\`provenance\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_evaluations\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`item_id\` numeric NOT NULL,
	\`parent_id\` numeric,
	\`remediation\` text,
	\`state\` text NOT NULL,
	\`input\` text NOT NULL,
	\`output\` text,
	\`owner\` text NOT NULL,
	\`turn_id\` numeric,
	\`model_version\` text,
	\`rule_version\` text,
	\`error\` text,
	\`judgment\` text,
	\`judgment_reason\` text,
	\`judge\` text,
	\`judged_at\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_evidence\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`case_id\` numeric NOT NULL,
	\`excerpt\` text,
	\`digest\` text NOT NULL,
	\`original_length\` numeric,
	\`purged_at\` text,
	\`purge_reason\` text,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_regressions\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`rule_id\` numeric NOT NULL,
	\`state\` text NOT NULL,
	\`results\` text,
	\`actor\` text NOT NULL,
	\`suite_version\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_releases\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`rule_id\` numeric NOT NULL,
	\`regression_id\` numeric NOT NULL,
	\`reason\` text NOT NULL,
	\`actor\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_rules\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`version\` text NOT NULL,
	\`reason\` text NOT NULL,
	\`mode\` text NOT NULL,
	\`extra_words\` text,
	\`ignored_words\` text,
	\`lexicon_version\` text NOT NULL,
	\`lexicon_hash\` text NOT NULL,
	\`prompt_version\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS \`safety_settings\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`acceptance_hours\` numeric NOT NULL,
	\`resolution_hours\` numeric NOT NULL,
	\`feedback_hours\` numeric NOT NULL,
	\`evidence_days\` numeric NOT NULL,
	\`staffing\` text NOT NULL,
	\`retention_basis\` text NOT NULL,
	\`reason\` text NOT NULL,
	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_audit_created_at_idx\` ON \`safety_audit\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_audit_updated_at_idx\` ON \`safety_audit\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_accept_by_idx\` ON \`safety_cases\` (\`accept_by\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_accepted_at_idx\` ON \`safety_cases\` (\`accepted_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_created_at_idx\` ON \`safety_cases\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_feedback_at_idx\` ON \`safety_cases\` (\`feedback_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_feedback_by_idx\` ON \`safety_cases\` (\`feedback_by\`)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS \`safety_cases_receipt_idx\` ON \`safety_cases\` (\`receipt\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_resolve_by_idx\` ON \`safety_cases\` (\`resolve_by\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_resolved_at_idx\` ON \`safety_cases\` (\`resolved_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_retain_until_idx\` ON \`safety_cases\` (\`retain_until\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_severity_idx\` ON \`safety_cases\` (\`severity\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_status_idx\` ON \`safety_cases\` (\`status\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_cases_updated_at_idx\` ON \`safety_cases\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_enforcements_created_at_idx\` ON \`safety_enforcements\` (\`created_at\`)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS \`safety_enforcements_key_idx\` ON \`safety_enforcements\` (\`key\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_enforcements_updated_at_idx\` ON \`safety_enforcements\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evaluation_items_created_at_idx\` ON \`safety_evaluation_items\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evaluation_items_updated_at_idx\` ON \`safety_evaluation_items\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evaluations_created_at_idx\` ON \`safety_evaluations\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evaluations_judged_at_idx\` ON \`safety_evaluations\` (\`judged_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evaluations_updated_at_idx\` ON \`safety_evaluations\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evidence_created_at_idx\` ON \`safety_evidence\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evidence_purged_at_idx\` ON \`safety_evidence\` (\`purged_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_evidence_updated_at_idx\` ON \`safety_evidence\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_regressions_created_at_idx\` ON \`safety_regressions\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_regressions_updated_at_idx\` ON \`safety_regressions\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_releases_created_at_idx\` ON \`safety_releases\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_releases_updated_at_idx\` ON \`safety_releases\` (\`updated_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_rules_created_at_idx\` ON \`safety_rules\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_rules_updated_at_idx\` ON \`safety_rules\` (\`updated_at\`)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS \`safety_rules_version_idx\` ON \`safety_rules\` (\`version\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_settings_created_at_idx\` ON \`safety_settings\` (\`created_at\`)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS \`safety_settings_updated_at_idx\` ON \`safety_settings\` (\`updated_at\`)`);
  const adminColumns = await db.all<{ name: string }>(sql`PRAGMA table_info(admins)`);
  if (!adminColumns.some((column) => column.name === 'role')) {
    await db.run(sql`ALTER TABLE admins ADD COLUMN role text DEFAULT 'reviewer' NOT NULL`);
    await db.run(sql`UPDATE admins SET role = 'administrator'`);
  }
  const mediaColumns = await db.all<{ name: string }>(sql`PRAGMA table_info(media)`);
  if (!mediaColumns.some((column) => column.name === 'safety_review'))
    await db.run(sql`ALTER TABLE media ADD COLUMN safety_review text`);
}
export async function down(): Promise<void> {
  throw new Error('运营案件、处置及审计不可自动丢弃；回退须先备份并保留已生效的访问限制。');
}
