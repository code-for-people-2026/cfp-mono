import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Issue #72 — drop the legacy content tables now that `create_site_content` has copied
// their data into `site_content` (+ site_documents jsonb columns). This migration is one-
// way: content now lives only in the new shape, so `down` is intentionally empty — recover
// from the pre-deploy export (see rollout notes) if this ever needs reversing.
//
// Run AFTER `create_site_content`. IF EXISTS / CASCADE make it idempotent and safe against
// FK dependencies (version tables reference their base tables).
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "website"."homepage_life_scenes_scenes_tags" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_life_scenes_scenes" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_continue_reads_items" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_dialogue_suggestions" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_direction_points" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_hero_flow" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_identity_cards" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_self_restraint_points" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage_why_now_points" CASCADE;
   DROP TABLE IF EXISTS "website"."homepage" CASCADE;
   DROP TABLE IF EXISTS "website"."footer_channels" CASCADE;
   DROP TABLE IF EXISTS "website"."footer_footer_links" CASCADE;
   DROP TABLE IF EXISTS "website"."footer" CASCADE;
   DROP TABLE IF EXISTS "website"."site_settings_header_nav" CASCADE;
   DROP TABLE IF EXISTS "website"."site_settings" CASCADE;
   DROP TABLE IF EXISTS "website"."chat_page" CASCADE;
   DROP TABLE IF EXISTS "website"."ui_strings" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_full_sections_paragraphs" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_full_sections_points" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_full_sections" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_sections_paragraphs" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_sections_points" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_sections" CASCADE;
   DROP TABLE IF EXISTS "website"."site_documents_guide" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_life_scenes_scenes_tags" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_life_scenes_scenes" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_continue_reads_items" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_dialogue_suggestions" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_direction_points" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_hero_flow" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_identity_cards" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_self_restraint_points" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v_version_why_now_points" CASCADE;
   DROP TABLE IF EXISTS "website"."_homepage_v" CASCADE;
   DROP TABLE IF EXISTS "website"."_footer_v_version_channels" CASCADE;
   DROP TABLE IF EXISTS "website"."_footer_v_version_footer_links" CASCADE;
   DROP TABLE IF EXISTS "website"."_footer_v" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_settings_v_version_header_nav" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_settings_v" CASCADE;
   DROP TABLE IF EXISTS "website"."_chat_page_v" CASCADE;
   DROP TABLE IF EXISTS "website"."_ui_strings_v" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_full_sections_paragraphs" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_full_sections_points" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_full_sections" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_guide" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_sections_paragraphs" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_sections_points" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v_version_sections" CASCADE;
   DROP TABLE IF EXISTS "website"."_site_documents_v" CASCADE;

   -- site_documents survives, but its _status column (drafts) is now orphaned — drop it
   -- before the enum it depends on.
   ALTER TABLE "website"."site_documents" DROP COLUMN IF EXISTS "_status";

   DROP TYPE IF EXISTS "website"."enum_homepage_status";
   DROP TYPE IF EXISTS "website"."enum__homepage_v_version_status";
   DROP TYPE IF EXISTS "website"."enum_homepage_continue_reads_items_target";
   DROP TYPE IF EXISTS "website"."enum__homepage_v_version_continue_reads_items_target";
   DROP TYPE IF EXISTS "website"."enum_chat_page_status";
   DROP TYPE IF EXISTS "website"."enum__chat_page_v_version_status";
   DROP TYPE IF EXISTS "website"."enum_ui_strings_status";
   DROP TYPE IF EXISTS "website"."enum__ui_strings_v_version_status";
   DROP TYPE IF EXISTS "website"."enum_site_settings_status";
   DROP TYPE IF EXISTS "website"."enum__site_settings_v_version_status";
   DROP TYPE IF EXISTS "website"."enum_footer_status";
   DROP TYPE IF EXISTS "website"."enum__footer_v_version_status";
   DROP TYPE IF EXISTS "website"."enum_footer_channels_icon_key";
   DROP TYPE IF EXISTS "website"."enum__footer_v_version_channels_icon_key";
   DROP TYPE IF EXISTS "website"."enum_site_documents_status";
   DROP TYPE IF EXISTS "website"."enum__site_documents_v_version_status";
   DROP TYPE IF EXISTS "website"."enum__site_documents_v_version_slug";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Intentionally empty — content lives only in site_content / site_documents jsonb now.
  // Recover from the pre-deploy export if a reversal is ever required.
}
