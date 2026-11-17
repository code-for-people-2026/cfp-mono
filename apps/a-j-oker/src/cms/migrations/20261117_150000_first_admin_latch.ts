import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE IF NOT EXISTS admin_initializations (
    id integer PRIMARY KEY NOT NULL,
    key text NOT NULL
  )`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS admin_initializations_key_idx
    ON admin_initializations (key)`);
  await db.run(sql`INSERT OR IGNORE INTO admin_initializations (key)
    SELECT 'first-administrator-created' WHERE EXISTS (SELECT 1 FROM admins LIMIT 1)`);
}

export async function down(): Promise<void> {
  throw new Error("管理员初始化锁不能删除，否则可能重新开放公共注册");
}
