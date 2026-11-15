import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(safety_cases)`);
  for (const [name, type] of [["alert_status", "text"], ["alert_next_at", "text"], ["alert_details", "text"]]) {
    if (!columns.some((column) => column.name === name)) await db.run(sql.raw(`ALTER TABLE safety_cases ADD COLUMN ${name} ${type}`));
  }
  await db.run(sql`CREATE INDEX IF NOT EXISTS safety_cases_alert_status_idx ON safety_cases(alert_status)`);
  await db.run(sql`CREATE INDEX IF NOT EXISTS safety_cases_alert_next_at_idx ON safety_cases(alert_next_at)`);
  await db.run(sql`CREATE TABLE IF NOT EXISTS safety_alert_state (
    id integer PRIMARY KEY NOT NULL, key text NOT NULL, fingerprint text, test_id text, tested_at text, verified_at text,
    heartbeat_at text, lease_token text, lease_until text, next_send_at text, last_error text,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS safety_alert_state_key_idx ON safety_alert_state(key)`);
  for (const name of ["tested_at", "verified_at", "heartbeat_at", "lease_until", "next_send_at", "updated_at", "created_at"])
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS safety_alert_state_${name}_idx ON safety_alert_state(${name})`));
}
export async function down(): Promise<void> { throw new Error("通知记录须先迁移归档，不能直接移除字段。"); }
