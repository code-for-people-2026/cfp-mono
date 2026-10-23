import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`service_memberships\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`service_memberships_key_idx\` ON \`service_memberships\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`service_memberships_baby_id_idx\` ON \`service_memberships\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`service_memberships_updated_at_idx\` ON \`service_memberships\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`service_memberships_created_at_idx\` ON \`service_memberships\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`service_membership_changes\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`service_membership_changes_key_idx\` ON \`service_membership_changes\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`service_membership_changes_baby_id_idx\` ON \`service_membership_changes\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`service_membership_changes_updated_at_idx\` ON \`service_membership_changes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`service_membership_changes_created_at_idx\` ON \`service_membership_changes\` (\`created_at\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`service_memberships\`;`)
  await db.run(sql`DROP TABLE \`service_membership_changes\`;`)
}
