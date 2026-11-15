import { type MigrateUpArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`agent_configs\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`key\` text NOT NULL,
  	\`enabled\` integer DEFAULT true NOT NULL,
  	\`prompt\` text NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`agent_configs_key_idx\` ON \`agent_configs\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`agent_configs_updated_at_idx\` ON \`agent_configs\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`agent_configs_created_at_idx\` ON \`agent_configs\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`agent_configs_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`knowledge_bases_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`agent_configs\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`knowledge_bases_id\`) REFERENCES \`knowledge_bases\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`agent_configs_rels_order_idx\` ON \`agent_configs_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`agent_configs_rels_parent_idx\` ON \`agent_configs_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`agent_configs_rels_path_idx\` ON \`agent_configs_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`agent_configs_rels_knowledge_bases_id_idx\` ON \`agent_configs_rels\` (\`knowledge_bases_id\`);`)
  await db.run(sql`CREATE TABLE \`knowledge_bases\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`enabled\` integer DEFAULT true NOT NULL,
  	\`provider\` text DEFAULT 'inline' NOT NULL,
  	\`content\` text,
  	\`knowledge_base_id\` text,
  	\`client_id\` text,
  	\`encrypted_api_key\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`knowledge_bases_updated_at_idx\` ON \`knowledge_bases\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`knowledge_bases_created_at_idx\` ON \`knowledge_bases\` (\`created_at\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`agent_configs_id\` integer REFERENCES agent_configs(id);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`knowledge_bases_id\` integer REFERENCES knowledge_bases(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_agent_configs_id_idx\` ON \`payload_locked_documents_rels\` (\`agent_configs_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_knowledge_bases_id_idx\` ON \`payload_locked_documents_rels\` (\`knowledge_bases_id\`);`)
}

export async function down(): Promise<void> {
  throw new Error("Agent 提示词和知识库已持久化，不能自动删表；请停止写入并按备份恢复流程回退。");
}
