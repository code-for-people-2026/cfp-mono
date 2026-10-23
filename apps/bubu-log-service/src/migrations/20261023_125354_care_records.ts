import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`care_events\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_events_key_idx\` ON \`care_events\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_events_baby_id_idx\` ON \`care_events\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_events_updated_at_idx\` ON \`care_events\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_events_created_at_idx\` ON \`care_events\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_operations\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_operations_key_idx\` ON \`care_operations\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_operations_baby_id_idx\` ON \`care_operations\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_operations_updated_at_idx\` ON \`care_operations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_operations_created_at_idx\` ON \`care_operations\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_revisions\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_revisions_key_idx\` ON \`care_revisions\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_revisions_baby_id_idx\` ON \`care_revisions\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_revisions_updated_at_idx\` ON \`care_revisions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_revisions_created_at_idx\` ON \`care_revisions\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_questions\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_questions_key_idx\` ON \`care_questions\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_questions_baby_id_idx\` ON \`care_questions\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_questions_updated_at_idx\` ON \`care_questions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_questions_created_at_idx\` ON \`care_questions\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_source_links\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_source_links_key_idx\` ON \`care_source_links\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_source_links_baby_id_idx\` ON \`care_source_links\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_source_links_updated_at_idx\` ON \`care_source_links\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_source_links_created_at_idx\` ON \`care_source_links\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_attachments\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_attachments_key_idx\` ON \`care_attachments\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_attachments_baby_id_idx\` ON \`care_attachments\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_attachments_updated_at_idx\` ON \`care_attachments\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_attachments_created_at_idx\` ON \`care_attachments\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_batches\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_batches_key_idx\` ON \`care_batches\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_batches_baby_id_idx\` ON \`care_batches\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_batches_updated_at_idx\` ON \`care_batches\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_batches_created_at_idx\` ON \`care_batches\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_sync\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_sync_key_idx\` ON \`care_sync\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_sync_baby_id_idx\` ON \`care_sync\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_sync_updated_at_idx\` ON \`care_sync\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_sync_created_at_idx\` ON \`care_sync\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`care_messages\` (
    \`id\` text PRIMARY KEY NOT NULL,
    \`key\` text NOT NULL,
    \`baby_id\` text NOT NULL,
    \`value\` text NOT NULL,
    \`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    \`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`care_messages_key_idx\` ON \`care_messages\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`care_messages_baby_id_idx\` ON \`care_messages\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`care_messages_updated_at_idx\` ON \`care_messages\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`care_messages_created_at_idx\` ON \`care_messages\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_events_id\` text REFERENCES care_events(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_operations_id\` text REFERENCES care_operations(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_revisions_id\` text REFERENCES care_revisions(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_questions_id\` text REFERENCES care_questions(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_source_links_id\` text REFERENCES care_source_links(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_attachments_id\` text REFERENCES care_attachments(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_batches_id\` text REFERENCES care_batches(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_sync_id\` text REFERENCES care_sync(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`care_messages_id\` text REFERENCES care_messages(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_events_id_idx\` ON \`payload_locked_documents_rels\` (\`care_events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_operations_id_idx\` ON \`payload_locked_documents_rels\` (\`care_operations_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_revisions_id_idx\` ON \`payload_locked_documents_rels\` (\`care_revisions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_questions_id_idx\` ON \`payload_locked_documents_rels\` (\`care_questions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_source_links_id_idx\` ON \`payload_locked_documents_rels\` (\`care_source_links_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_attachments_id_idx\` ON \`payload_locked_documents_rels\` (\`care_attachments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_batches_id_idx\` ON \`payload_locked_documents_rels\` (\`care_batches_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_sync_id_idx\` ON \`payload_locked_documents_rels\` (\`care_sync_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_messages_id_idx\` ON \`payload_locked_documents_rels\` (\`care_messages_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`care_events\`;`)
  await db.run(sql`DROP TABLE \`care_operations\`;`)
  await db.run(sql`DROP TABLE \`care_revisions\`;`)
  await db.run(sql`DROP TABLE \`care_questions\`;`)
  await db.run(sql`DROP TABLE \`care_source_links\`;`)
  await db.run(sql`DROP TABLE \`care_attachments\`;`)
  await db.run(sql`DROP TABLE \`care_batches\`;`)
  await db.run(sql`DROP TABLE \`care_sync\`;`)
  await db.run(sql`DROP TABLE \`care_messages\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
    \`id\` integer PRIMARY KEY NOT NULL,
    \`order\` integer,
    \`parent_id\` integer NOT NULL,
    \`path\` text NOT NULL,
    \`identities_id\` text,
    \`sessions_id\` text,
    \`grants_id\` text,
    \`invitations_id\` text,
    \`group_bindings_id\` text,
    \`audit_id\` text,
    \`users_id\` integer,
    FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`identities_id\`) REFERENCES \`identities\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`sessions_id\`) REFERENCES \`sessions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`grants_id\`) REFERENCES \`grants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`invitations_id\`) REFERENCES \`invitations\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`group_bindings_id\`) REFERENCES \`group_bindings\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`audit_id\`) REFERENCES \`audit\`(\`id\`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "identities_id", "sessions_id", "grants_id", "invitations_id", "group_bindings_id", "audit_id", "users_id") SELECT "id", "order", "parent_id", "path", "identities_id", "sessions_id", "grants_id", "invitations_id", "group_bindings_id", "audit_id", "users_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_identities_id_idx\` ON \`payload_locked_documents_rels\` (\`identities_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_sessions_id_idx\` ON \`payload_locked_documents_rels\` (\`sessions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_grants_id_idx\` ON \`payload_locked_documents_rels\` (\`grants_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_invitations_id_idx\` ON \`payload_locked_documents_rels\` (\`invitations_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_group_bindings_id_idx\` ON \`payload_locked_documents_rels\` (\`group_bindings_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_audit_id_idx\` ON \`payload_locked_documents_rels\` (\`audit_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
}
