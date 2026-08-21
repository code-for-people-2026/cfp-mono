import { MigrateDownArgs, MigrateUpArgs, sql } from "@payloadcms/db-postgres";
import { neighborsProduct } from "../../content/neighbors";

// Keep the formal product page, homepage discovery answer, and chat on one Payload row.
// Existing installations receive the complete approved record instead of an empty json
// object, so the first CMS edit starts from the same contract as a fresh seed.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  const product = JSON.stringify(neighborsProduct);
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
