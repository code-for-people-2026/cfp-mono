import { MigrateDownArgs, MigrateUpArgs, sql } from "@payloadcms/db-postgres";

// Production renders the published Payload records before the static fallback. Keep the
// existing CMS content in sync with the renamed source copy when this deploy starts.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE
      content_column record;
      previous_name CONSTANT text := chr(30721) || chr(25104) || chr(24037);
      current_name CONSTANT text := '码成仝';
    BEGIN
      FOR content_column IN
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'website'
          AND table_name IN ('site_content', 'site_documents')
          AND data_type IN ('character varying', 'text', 'jsonb')
      LOOP
        IF content_column.data_type = 'jsonb' THEN
          EXECUTE format(
            'UPDATE %I.%I SET %I = replace(%I::text, $1, $2)::jsonb WHERE %I::text LIKE $3',
            content_column.table_schema,
            content_column.table_name,
            content_column.column_name,
            content_column.column_name,
            content_column.column_name
          ) USING previous_name, current_name, '%' || previous_name || '%';
        ELSE
          EXECUTE format(
            'UPDATE %I.%I SET %I = replace(%I, $1, $2) WHERE %I LIKE $3',
            content_column.table_schema,
            content_column.table_name,
            content_column.column_name,
            content_column.column_name,
            content_column.column_name
          ) USING previous_name, current_name, '%' || previous_name || '%';
        END IF;
      END LOOP;

      UPDATE "website"."site_content" SET "updated_at" = NOW();
      UPDATE "website"."site_documents" SET "updated_at" = NOW();
    END $$;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE
      content_column record;
      previous_name CONSTANT text := chr(30721) || chr(25104) || chr(24037);
      current_name CONSTANT text := '码成仝';
    BEGIN
      FOR content_column IN
        SELECT table_schema, table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'website'
          AND table_name IN ('site_content', 'site_documents')
          AND data_type IN ('character varying', 'text', 'jsonb')
      LOOP
        IF content_column.data_type = 'jsonb' THEN
          EXECUTE format(
            'UPDATE %I.%I SET %I = replace(%I::text, $1, $2)::jsonb WHERE %I::text LIKE $3',
            content_column.table_schema,
            content_column.table_name,
            content_column.column_name,
            content_column.column_name,
            content_column.column_name
          ) USING current_name, previous_name, '%' || current_name || '%';
        ELSE
          EXECUTE format(
            'UPDATE %I.%I SET %I = replace(%I, $1, $2) WHERE %I LIKE $3',
            content_column.table_schema,
            content_column.table_name,
            content_column.column_name,
            content_column.column_name,
            content_column.column_name
          ) USING current_name, previous_name, '%' || current_name || '%';
        END IF;
      END LOOP;

      UPDATE "website"."site_content" SET "updated_at" = NOW();
      UPDATE "website"."site_documents" SET "updated_at" = NOW();
    END $$;
  `);
}
