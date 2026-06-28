import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Issue #72 — collapse the five content globals (homepage/footer/site-settings/chat-page/
// ui-strings) into one `site_content` global, and turn site_documents' relational arrays
// (guide/sections/fullSections) into jsonb columns. Drafts are off everywhere now, so no
// `_status`/version tables are created for site_content.
//
// This migration CREATES the new shape and BACKFILLS it from the legacy tables in the same
// `up()` (legacy tables are left intact — migration `drop_legacy_content` removes them
// after this one has run). Run order A→B guarantees content is copied before it is dropped.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   -- P1 (#74): refuse to run if any legacy content has an unpublished draft. This migration
   -- backfills from the base (published) tables, and the follow-up drops the _status column
   -- and the version tables that hold drafts — so an unpublished draft would silently become
   -- the live content. Publish or discard every draft first, then redeploy.
   DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM "website"."homepage" WHERE _status = 'draft')
        OR EXISTS (SELECT 1 FROM "website"."footer" WHERE _status = 'draft')
        OR EXISTS (SELECT 1 FROM "website"."site_settings" WHERE _status = 'draft')
        OR EXISTS (SELECT 1 FROM "website"."chat_page" WHERE _status = 'draft')
        OR EXISTS (SELECT 1 FROM "website"."ui_strings" WHERE _status = 'draft')
        OR EXISTS (SELECT 1 FROM "website"."site_documents" WHERE _status = 'draft')
     THEN
       RAISE EXCEPTION 'website content has unpublished drafts — publish or discard them in the CMS before running this migration';
     END IF;
   END $$;

   CREATE TABLE "website"."site_content" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_kicker" varchar NOT NULL,
  	"hero_title" varchar NOT NULL,
  	"hero_organization_line" varchar NOT NULL,
  	"hero_manifesto_line" varchar NOT NULL,
  	"hero_body" varchar,
  	"dialogue_entry_prompt" varchar NOT NULL,
  	"dialogue_entry_placeholder" varchar NOT NULL,
  	"dialogue_entry_submit_label" varchar NOT NULL,
  	"dialogue_entry_note" varchar NOT NULL,
  	"dialogue_suggestions" jsonb DEFAULT '[]'::jsonb,
  	"hero_flow" jsonb DEFAULT '[]'::jsonb,
  	"identity_heading" varchar NOT NULL,
  	"identity_intro" varchar NOT NULL,
  	"identity_cards" jsonb DEFAULT '[]'::jsonb,
  	"why_now_heading" varchar NOT NULL,
  	"why_now_intro" varchar NOT NULL,
  	"why_now_points" jsonb DEFAULT '[]'::jsonb,
  	"life_scenes_heading" varchar NOT NULL,
  	"life_scenes_intro" varchar NOT NULL,
  	"life_scenes_scenes" jsonb DEFAULT '[]'::jsonb,
  	"direction_heading" varchar NOT NULL,
  	"direction_intro" varchar NOT NULL,
  	"direction_points" jsonb DEFAULT '[]'::jsonb,
  	"self_restraint_heading" varchar NOT NULL,
  	"self_restraint_intro" varchar NOT NULL,
  	"self_restraint_points" jsonb DEFAULT '[]'::jsonb,
  	"continue_reads_heading" varchar NOT NULL,
  	"continue_reads_intro" varchar NOT NULL,
  	"continue_reads_items" jsonb DEFAULT '[]'::jsonb,
  	"description" varchar NOT NULL,
  	"links_heading" varchar NOT NULL,
  	"footer_links" jsonb DEFAULT '[]'::jsonb,
  	"channels_heading" varchar NOT NULL,
  	"channels" jsonb DEFAULT '[]'::jsonb,
  	"github_label" varchar NOT NULL,
  	"beian" varchar,
  	"copyright" varchar NOT NULL,
  	"share_title" varchar NOT NULL,
  	"share_description" varchar NOT NULL,
  	"direction_map_url" varchar NOT NULL,
  	"github_url" varchar NOT NULL,
  	"brand_wordmark" varchar NOT NULL,
  	"brand_tagline" varchar NOT NULL,
  	"brand_logo_path" varchar NOT NULL,
  	"brand_logo_alt" varchar NOT NULL,
  	"header_nav" jsonb DEFAULT '[]'::jsonb,
  	"chat_heading" varchar NOT NULL,
  	"chat_intro" varchar NOT NULL,
  	"back_to_home" varchar NOT NULL,
  	"send_label" varchar NOT NULL,
  	"chat_restart" varchar NOT NULL,
  	"chat_loading" varchar NOT NULL,
  	"chat_disclaimer" varchar NOT NULL,
  	"chat_assistant_name" varchar NOT NULL,
  	"chat_user_name" varchar NOT NULL,
  	"chat_placeholder" varchar NOT NULL,
  	"chat_reset_confirm" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );

  ALTER TABLE "website"."site_documents" ADD COLUMN "guide" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "website"."site_documents" ADD COLUMN "sections" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "website"."site_documents" ADD COLUMN "full_sections" jsonb DEFAULT '[]'::jsonb;

  -- Backfill site_content from the five legacy singleton globals (cross-join = one row),
  -- aggregating each relational array child into a camelCase-keyed jsonb list ordered by
  -- the original _order. Mirrors the json shapes lib/content/mappers.ts expects.
  INSERT INTO "website"."site_content" (
    "hero_kicker","hero_title","hero_organization_line","hero_manifesto_line","hero_body",
    "dialogue_entry_prompt","dialogue_entry_placeholder","dialogue_entry_submit_label","dialogue_entry_note",
    "identity_heading","identity_intro","why_now_heading","why_now_intro",
    "life_scenes_heading","life_scenes_intro","direction_heading","direction_intro",
    "self_restraint_heading","self_restraint_intro","continue_reads_heading","continue_reads_intro",
    "description","links_heading","channels_heading","github_label","beian","copyright",
    "share_title","share_description","direction_map_url","github_url",
    "brand_wordmark","brand_tagline","brand_logo_path","brand_logo_alt",
    "chat_heading","chat_intro",
    "back_to_home","send_label","chat_restart","chat_loading","chat_disclaimer","chat_assistant_name","chat_user_name","chat_placeholder","chat_reset_confirm",
    "dialogue_suggestions","hero_flow","identity_cards","why_now_points","life_scenes_scenes","direction_points","self_restraint_points","continue_reads_items",
    "footer_links","channels","header_nav"
  )
  SELECT
    h."hero_kicker", h."hero_title", h."hero_organization_line", h."hero_manifesto_line", h."hero_body",
    h."dialogue_entry_prompt", h."dialogue_entry_placeholder", h."dialogue_entry_submit_label", h."dialogue_entry_note",
    h."identity_heading", h."identity_intro", h."why_now_heading", h."why_now_intro",
    h."life_scenes_heading", h."life_scenes_intro", h."direction_heading", h."direction_intro",
    h."self_restraint_heading", h."self_restraint_intro", h."continue_reads_heading", h."continue_reads_intro",
    f."description", f."links_heading", f."channels_heading", f."github_label", f."beian", f."copyright",
    s."share_title", s."share_description", s."direction_map_url", s."github_url",
    s."brand_wordmark", s."brand_tagline", s."brand_logo_path", s."brand_logo_alt",
    c."heading", c."intro",
    u."back_to_home", u."send_label", u."chat_restart", u."chat_loading", u."chat_disclaimer", u."chat_assistant_name", u."chat_user_name", u."chat_placeholder", u."chat_reset_confirm",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'value',"value") ORDER BY "_order") FROM "website"."homepage_dialogue_suggestions" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',"title",'body',"body") ORDER BY "_order") FROM "website"."homepage_hero_flow" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',"title",'body',"body") ORDER BY "_order") FROM "website"."homepage_identity_cards" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',"title",'body',"body") ORDER BY "_order") FROM "website"."homepage_why_now_points" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',"title",'body',"body",'tags', COALESCE((SELECT jsonb_agg("tag" ORDER BY "_order") FROM "website"."homepage_life_scenes_scenes_tags" WHERE "_parent_id" = sc."id"), '[]'::jsonb)) ORDER BY "_order") FROM "website"."homepage_life_scenes_scenes" sc WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',"title",'body',"body") ORDER BY "_order") FROM "website"."homepage_direction_points" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('title',"title",'body',"body") ORDER BY "_order") FROM "website"."homepage_self_restraint_points" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'description',"description",'target',"target") ORDER BY "_order") FROM "website"."homepage_continue_reads_items" WHERE "_parent_id" = h."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'href',"href") ORDER BY "_order") FROM "website"."footer_footer_links" WHERE "_parent_id" = f."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'iconKey',"icon_key",'status',"status",'description',"description",'qrPath',"qr_path",'qrAlt',"qr_alt") ORDER BY "_order") FROM "website"."footer_channels" WHERE "_parent_id" = f."id"), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'href',"href") ORDER BY "_order") FROM "website"."site_settings_header_nav" WHERE "_parent_id" = s."id"), '[]'::jsonb)
  FROM "website"."homepage" h, "website"."footer" f, "website"."site_settings" s, "website"."chat_page" c, "website"."ui_strings" u;

  -- Backfill site_documents jsonb columns from the relational array children.
  UPDATE "website"."site_documents" SET
    "guide" = COALESCE((SELECT jsonb_agg("text" ORDER BY "_order") FROM "website"."site_documents_guide" WHERE "_parent_id" = "site_documents"."id"), '[]'::jsonb),
    "sections" = COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'heading',"heading",'paragraphs', COALESCE((SELECT jsonb_agg("text" ORDER BY "_order") FROM "website"."site_documents_sections_paragraphs" WHERE "_parent_id" = sec."id"), '[]'::jsonb), 'points', COALESCE((SELECT jsonb_agg("text" ORDER BY "_order") FROM "website"."site_documents_sections_points" WHERE "_parent_id" = sec."id"), '[]'::jsonb)) ORDER BY "_order") FROM "website"."site_documents_sections" sec WHERE "_parent_id" = "site_documents"."id"), '[]'::jsonb),
    "full_sections" = COALESCE((SELECT jsonb_agg(jsonb_build_object('label',"label",'heading',"heading",'paragraphs', COALESCE((SELECT jsonb_agg("text" ORDER BY "_order") FROM "website"."site_documents_full_sections_paragraphs" WHERE "_parent_id" = fsec."id"), '[]'::jsonb), 'points', COALESCE((SELECT jsonb_agg("text" ORDER BY "_order") FROM "website"."site_documents_full_sections_points" WHERE "_parent_id" = fsec."id"), '[]'::jsonb)) ORDER BY "_order") FROM "website"."site_documents_full_sections" fsec WHERE "_parent_id" = "site_documents"."id"), '[]'::jsonb);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "website"."site_content";
   ALTER TABLE "website"."site_documents" DROP COLUMN "guide";
   ALTER TABLE "website"."site_documents" DROP COLUMN "sections";
   ALTER TABLE "website"."site_documents" DROP COLUMN "full_sections";`)
}
