import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`privacy_state\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`identity_id\` text,
  	\`baby_id\` text,
  	\`value\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`privacy_state_key_idx\` ON \`privacy_state\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`privacy_state_identity_id_idx\` ON \`privacy_state\` (\`identity_id\`);`)
  await db.run(sql`CREATE INDEX \`privacy_state_baby_id_idx\` ON \`privacy_state\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`privacy_state_updated_at_idx\` ON \`privacy_state\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`privacy_state_created_at_idx\` ON \`privacy_state\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`privacy_requests\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`identity_id\` text,
  	\`baby_id\` text,
  	\`value\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`privacy_requests_key_idx\` ON \`privacy_requests\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`privacy_requests_identity_id_idx\` ON \`privacy_requests\` (\`identity_id\`);`)
  await db.run(sql`CREATE INDEX \`privacy_requests_baby_id_idx\` ON \`privacy_requests\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`privacy_requests_updated_at_idx\` ON \`privacy_requests\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`privacy_requests_created_at_idx\` ON \`privacy_requests\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`safety_signals\` (
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`identity_id\` text,
  	\`baby_id\` text,
  	\`value\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`safety_signals_key_idx\` ON \`safety_signals\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`safety_signals_identity_id_idx\` ON \`safety_signals\` (\`identity_id\`);`)
  await db.run(sql`CREATE INDEX \`safety_signals_baby_id_idx\` ON \`safety_signals\` (\`baby_id\`);`)
  await db.run(sql`CREATE INDEX \`safety_signals_updated_at_idx\` ON \`safety_signals\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`safety_signals_created_at_idx\` ON \`safety_signals\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`privacy_state_id\` text REFERENCES privacy_state(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`privacy_requests_id\` text REFERENCES privacy_requests(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`safety_signals_id\` text REFERENCES safety_signals(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_privacy_state_id_idx\` ON \`payload_locked_documents_rels\` (\`privacy_state_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_privacy_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`privacy_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_safety_signals_id_idx\` ON \`payload_locked_documents_rels\` (\`safety_signals_id\`);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`privacy_state\`;`)
  await db.run(sql`DROP TABLE \`privacy_requests\`;`)
  await db.run(sql`DROP TABLE \`safety_signals\`;`)
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
  	\`care_events_id\` text,
  	\`care_operations_id\` text,
  	\`care_revisions_id\` text,
  	\`care_questions_id\` text,
  	\`care_source_links_id\` text,
  	\`care_attachments_id\` text,
  	\`care_batches_id\` text,
  	\`care_sync_id\` text,
  	\`care_messages_id\` text,
  	\`chat_turns_id\` text,
  	\`users_id\` integer,
  	\`ops_requests_id\` text,
  	\`ops_users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`identities_id\`) REFERENCES \`identities\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`sessions_id\`) REFERENCES \`sessions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`grants_id\`) REFERENCES \`grants\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`invitations_id\`) REFERENCES \`invitations\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`group_bindings_id\`) REFERENCES \`group_bindings\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`audit_id\`) REFERENCES \`audit\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_events_id\`) REFERENCES \`care_events\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_operations_id\`) REFERENCES \`care_operations\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_revisions_id\`) REFERENCES \`care_revisions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_questions_id\`) REFERENCES \`care_questions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_source_links_id\`) REFERENCES \`care_source_links\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_attachments_id\`) REFERENCES \`care_attachments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_batches_id\`) REFERENCES \`care_batches\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_sync_id\`) REFERENCES \`care_sync\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`care_messages_id\`) REFERENCES \`care_messages\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`chat_turns_id\`) REFERENCES \`chat_turns\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`ops_requests_id\`) REFERENCES \`ops_requests\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`ops_users_id\`) REFERENCES \`ops_users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "identities_id", "sessions_id", "grants_id", "invitations_id", "group_bindings_id", "audit_id", "care_events_id", "care_operations_id", "care_revisions_id", "care_questions_id", "care_source_links_id", "care_attachments_id", "care_batches_id", "care_sync_id", "care_messages_id", "chat_turns_id", "users_id", "ops_requests_id", "ops_users_id") SELECT "id", "order", "parent_id", "path", "identities_id", "sessions_id", "grants_id", "invitations_id", "group_bindings_id", "audit_id", "care_events_id", "care_operations_id", "care_revisions_id", "care_questions_id", "care_source_links_id", "care_attachments_id", "care_batches_id", "care_sync_id", "care_messages_id", "chat_turns_id", "users_id", "ops_requests_id", "ops_users_id" FROM \`payload_locked_documents_rels\`;`)
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
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_events_id_idx\` ON \`payload_locked_documents_rels\` (\`care_events_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_operations_id_idx\` ON \`payload_locked_documents_rels\` (\`care_operations_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_revisions_id_idx\` ON \`payload_locked_documents_rels\` (\`care_revisions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_questions_id_idx\` ON \`payload_locked_documents_rels\` (\`care_questions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_source_links_id_idx\` ON \`payload_locked_documents_rels\` (\`care_source_links_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_attachments_id_idx\` ON \`payload_locked_documents_rels\` (\`care_attachments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_batches_id_idx\` ON \`payload_locked_documents_rels\` (\`care_batches_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_sync_id_idx\` ON \`payload_locked_documents_rels\` (\`care_sync_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_care_messages_id_idx\` ON \`payload_locked_documents_rels\` (\`care_messages_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_chat_turns_id_idx\` ON \`payload_locked_documents_rels\` (\`chat_turns_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ops_requests_id_idx\` ON \`payload_locked_documents_rels\` (\`ops_requests_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_ops_users_id_idx\` ON \`payload_locked_documents_rels\` (\`ops_users_id\`);`)
}
