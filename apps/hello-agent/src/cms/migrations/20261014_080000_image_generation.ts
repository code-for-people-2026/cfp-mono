import { type MigrateUpArgs, sql } from "@payloadcms/db-sqlite";

export async function up({ db }: MigrateUpArgs): Promise<void> {
  const turns = await db.all<{ name: string }>(sql`PRAGMA table_info(greetings)`);
  if (!turns.some((column) => column.name === "image_generation")) await db.run(sql`ALTER TABLE greetings ADD COLUMN image_generation text`);
  const media = await db.all<{ name: string }>(sql`PRAGMA table_info(media)`);
  if (!media.some((column) => column.name === "generation")) await db.run(sql`ALTER TABLE media ADD COLUMN generation text`);
  if (!media.some((column) => column.name === "generation_key")) await db.run(sql`ALTER TABLE media ADD COLUMN generation_key text`);
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS media_generation_key_idx ON media (generation_key)`);
}
export async function down(): Promise<void> {
  throw new Error("生图任务与来源记录不可自动丢弃；请备份并按恢复规程回退。");
}
