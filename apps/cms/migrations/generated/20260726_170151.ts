/* eslint-disable @typescript-eslint/no-unused-vars */
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "cms"."enum_kiv1_service_closures_occasion" AS ENUM('lunch', 'dinner');
  CREATE TYPE "cms"."enum_kiv1_booking_batches_target_kind" AS ENUM('day', 'meal');
  CREATE TYPE "cms"."enum_kiv1_booking_batches_target_occasion" AS ENUM('lunch', 'dinner');
  CREATE TABLE "cms"."kiv1_service_closures" (
    "id" serial PRIMARY KEY NOT NULL,
    "seller_id" integer NOT NULL,
    "date" varchar NOT NULL,
    "occasion" "cms"."enum_kiv1_service_closures_occasion",
    "note" varchar,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "cms"."kiv1_booking_batches" ADD COLUMN "target_kind" "cms"."enum_kiv1_booking_batches_target_kind";
  ALTER TABLE "cms"."kiv1_booking_batches" ADD COLUMN "target_date" varchar;
  ALTER TABLE "cms"."kiv1_booking_batches" ADD COLUMN "target_occasion" "cms"."enum_kiv1_booking_batches_target_occasion";
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD COLUMN "kiv1_service_closures_id" integer;
  ALTER TABLE "cms"."kiv1_service_closures" ADD CONSTRAINT "kiv1_service_closures_seller_id_kiv1_sellers_id_fk" FOREIGN KEY ("seller_id") REFERENCES "cms"."kiv1_sellers"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "kiv1_service_closures_seller_idx" ON "cms"."kiv1_service_closures" USING btree ("seller_id");
  CREATE INDEX "kiv1_service_closures_updated_at_idx" ON "cms"."kiv1_service_closures" USING btree ("updated_at");
  CREATE INDEX "kiv1_service_closures_created_at_idx" ON "cms"."kiv1_service_closures" USING btree ("created_at");
  CREATE INDEX "seller_date_occasion_1_idx" ON "cms"."kiv1_service_closures" USING btree ("seller_id","date","occasion");
  CREATE UNIQUE INDEX "kiv1_service_closures_seller_date_day_unique"
    ON "cms"."kiv1_service_closures" ("seller_id", "date") WHERE "occasion" IS NULL;
  CREATE UNIQUE INDEX "kiv1_service_closures_seller_date_occasion_unique"
    ON "cms"."kiv1_service_closures" ("seller_id", "date", "occasion") WHERE "occasion" IS NOT NULL;
  ALTER TABLE "cms"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_kiv1_service_closures_fk" FOREIGN KEY ("kiv1_service_closures_id") REFERENCES "cms"."kiv1_service_closures"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_kiv1_service_closures_id_idx" ON "cms"."payload_locked_documents_rels" USING btree ("kiv1_service_closures_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cms"."payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_kiv1_service_closures_fk";
  DROP INDEX "cms"."payload_locked_documents_rels_kiv1_service_closures_id_idx";
  ALTER TABLE "cms"."payload_locked_documents_rels" DROP COLUMN "kiv1_service_closures_id";
  ALTER TABLE "cms"."kiv1_service_closures" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "cms"."kiv1_service_closures";
  ALTER TABLE "cms"."kiv1_booking_batches" DROP COLUMN "target_kind";
  ALTER TABLE "cms"."kiv1_booking_batches" DROP COLUMN "target_date";
  ALTER TABLE "cms"."kiv1_booking_batches" DROP COLUMN "target_occasion";
  DROP TYPE "cms"."enum_kiv1_service_closures_occasion";
  DROP TYPE "cms"."enum_kiv1_booking_batches_target_kind";
  DROP TYPE "cms"."enum_kiv1_booking_batches_target_occasion";`)
}
