import { type MigrateUpArgs, sql } from '@payloadcms/db-sqlite';

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS privacy_profiles (
    id integer PRIMARY KEY NOT NULL,
    owner text NOT NULL,
    state text NOT NULL,
    consent text,
    sensitive_history integer DEFAULT false,
    events text,
    recovery_digest text,
    expires_at text,
    deleted_at text,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS privacy_profiles_owner_idx ON privacy_profiles (owner)`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS privacy_profiles_recovery_digest_idx ON privacy_profiles (recovery_digest)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS privacy_profiles_updated_at_idx ON privacy_profiles (updated_at)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS privacy_profiles_created_at_idx ON privacy_profiles (created_at)`);
  // Hidden service-only collection is never edited in the admin UI; no locked-document relation is used.
}
export async function down(): Promise<void> {
  throw new Error("隐私授权与删除凭据不可自动丢弃；回退前必须保留删除清单并按恢复规程处理。");
}
