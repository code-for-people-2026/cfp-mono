import { MigrateDownArgs, MigrateUpArgs, sql } from "@payloadcms/db-postgres";
import { neighborsPage } from "../../content/neighbors";

// Historical additive step kept reproducible for databases that have not run it yet.
// The next migration replaces this temporary jsonb column with structured page fields.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // This temporary jsonb column is replaced by structured fields in the next
  // migration. Reusing the current approved record keeps fresh databases reproducible.
  const product = JSON.stringify(neighborsPage);
  await db.execute(sql`
    ALTER TABLE "website"."site_content"
      ADD COLUMN "neighbors_product" jsonb DEFAULT '{}'::jsonb NOT NULL;
  `);
  await db.execute(sql`
    UPDATE "website"."site_content"
      SET "neighbors_product" = ${product}::jsonb,
          "updated_at" = NOW();
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "website"."site_content" DROP COLUMN "neighbors_product";
  `);
}
