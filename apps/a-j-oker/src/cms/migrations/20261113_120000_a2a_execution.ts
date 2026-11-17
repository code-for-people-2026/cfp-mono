import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS a2a_execution_tasks (
    id integer PRIMARY KEY NOT NULL,
    owner text NOT NULL,
    tenant text NOT NULL,
    agent_id text NOT NULL,
    key text NOT NULL,
    task_id text NOT NULL,
    context_id text NOT NULL,
    state numeric NOT NULL,
    status_timestamp text,
    revision numeric NOT NULL,
    snapshot text NOT NULL,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS a2a_execution_tasks_key_idx ON a2a_execution_tasks(key)`);
  for (const name of ["owner", "tenant", "agent_id", "task_id", "context_id", "state", "status_timestamp", "updated_at", "created_at"])
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS a2a_execution_tasks_${name}_idx ON a2a_execution_tasks(${name})`));

  await db.run(sql`CREATE TABLE IF NOT EXISTS a2a_request_ledgers (
    id integer PRIMARY KEY NOT NULL,
    owner text NOT NULL,
    tenant text NOT NULL,
    agent_id text NOT NULL,
    key text NOT NULL,
    request_identity text NOT NULL,
    fingerprint text NOT NULL,
    status text NOT NULL,
    task_id text,
    context_id text,
    revision numeric NOT NULL,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS a2a_request_ledgers_key_idx ON a2a_request_ledgers(key)`);
  for (const name of ["owner", "tenant", "agent_id", "task_id", "context_id", "updated_at", "created_at"])
    await db.run(sql.raw(`CREATE INDEX IF NOT EXISTS a2a_request_ledgers_${name}_idx ON a2a_request_ledgers(${name})`));
}

export async function down(): Promise<void> {
  throw new Error("A2A 执行任务与幂等账本不可自动删除；请先完成备份和隐私清理。 ");
}
