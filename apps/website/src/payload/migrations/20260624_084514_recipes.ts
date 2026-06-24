import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "website"."enum_recipes_category" AS ENUM('big-meat', 'small-meat', 'vegetable');
  CREATE TABLE "website"."recipes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"category" "website"."enum_recipes_category" DEFAULT 'vegetable' NOT NULL,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "website"."payload_locked_documents_rels" ADD COLUMN "recipes_id" integer;
  CREATE INDEX "recipes_name_idx" ON "website"."recipes" USING btree ("name");
  CREATE INDEX "recipes_category_idx" ON "website"."recipes" USING btree ("category");
  CREATE INDEX "recipes_updated_at_idx" ON "website"."recipes" USING btree ("updated_at");
  CREATE INDEX "recipes_created_at_idx" ON "website"."recipes" USING btree ("created_at");
  ALTER TABLE "website"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_recipes_fk" FOREIGN KEY ("recipes_id") REFERENCES "website"."recipes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_recipes_id_idx" ON "website"."payload_locked_documents_rels" USING btree ("recipes_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "website"."recipes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "website"."recipes" CASCADE;
  ALTER TABLE "website"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_recipes_fk";
  
  DROP INDEX "website"."payload_locked_documents_rels_recipes_id_idx";
  ALTER TABLE "website"."payload_locked_documents_rels" DROP COLUMN "recipes_id";
  DROP TYPE "website"."enum_recipes_category";`)
}
