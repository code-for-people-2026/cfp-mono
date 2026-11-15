import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(credentials)`);
  if (!columns.some((column) => column.name === "wechat_key")) await db.run(sql`ALTER TABLE credentials ADD COLUMN wechat_key text`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS wechat_identities (
    id integer PRIMARY KEY NOT NULL, key text NOT NULL, owner text NOT NULL, notice_version text, consented_at text,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS wechat_identities_key_idx ON wechat_identities (key)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS wechat_identities_owner_idx ON wechat_identities (owner)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS wechat_identities_updated_at_idx ON wechat_identities (updated_at)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS wechat_identities_created_at_idx ON wechat_identities (created_at)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS age_profiles (
    id integer PRIMARY KEY NOT NULL, owner text NOT NULL, state text NOT NULL,
    declaration text, notice_version text, consented_at text, challenge text, challenge_expires_at text,
    verified_at text, expires_at text, source text, reference text, assurance text, additional_verification text,
    last_attempt_at text, day text, attempts numeric DEFAULT 0,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS age_profiles_owner_idx ON age_profiles (owner)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS age_profiles_updated_at_idx ON age_profiles (updated_at)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS age_profiles_created_at_idx ON age_profiles (created_at)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS age_locks (
    id integer PRIMARY KEY NOT NULL, key text NOT NULL, nonce text NOT NULL, expires_at text NOT NULL,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS age_locks_key_idx ON age_locks (key)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS age_locks_updated_at_idx ON age_locks (updated_at)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS age_locks_created_at_idx ON age_locks (created_at)`);
}
export async function down(): Promise<void> {
  throw new Error("微信身份绑定与核验记录不可自动丢弃；先导出最小状态并按数据恢复规程回退。");
}
