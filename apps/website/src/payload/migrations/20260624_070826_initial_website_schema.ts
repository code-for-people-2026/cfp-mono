import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE SCHEMA IF NOT EXISTS "website";
  CREATE TYPE "website"."enum_site_documents_slug" AS ENUM('manifesto', 'license');
  CREATE TYPE "website"."enum_site_documents_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum__site_documents_v_version_slug" AS ENUM('manifesto', 'license');
  CREATE TYPE "website"."enum__site_documents_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum_form_links_purpose" AS ENUM('collaborate', 'need', 'critique');
  CREATE TYPE "website"."enum_matrix_submissions_cell_id" AS ENUM('A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'A2', 'B2', 'C2', 'D2', 'E2', 'F2', 'G2', 'H2', 'A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'A4', 'B4', 'C4', 'D4', 'E4', 'F4', 'G4', 'H4', 'A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5', 'A6', 'B6', 'C6', 'D6', 'E6', 'F6', 'G6', 'H6', 'A7', 'B7', 'C7', 'D7', 'E7', 'F7', 'G7', 'H7');
  CREATE TYPE "website"."enum_matrix_submissions_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TYPE "website"."enum_homepage_continue_reads_items_target" AS ENUM('manifesto', 'map', 'license');
  CREATE TYPE "website"."enum_homepage_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum__homepage_v_version_continue_reads_items_target" AS ENUM('manifesto', 'map', 'license');
  CREATE TYPE "website"."enum__homepage_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum_chat_page_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum__chat_page_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum_ui_strings_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum__ui_strings_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum_site_settings_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum__site_settings_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum_footer_channels_icon_key" AS ENUM('douyin', 'kuaishou', 'bilibili');
  CREATE TYPE "website"."enum_footer_status" AS ENUM('draft', 'published');
  CREATE TYPE "website"."enum__footer_v_version_channels_icon_key" AS ENUM('douyin', 'kuaishou', 'bilibili');
  CREATE TYPE "website"."enum__footer_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "website"."cms_admins_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "website"."cms_admins" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"display_name" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "website"."site_documents_guide" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "website"."site_documents_sections_paragraphs" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "website"."site_documents_sections_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "website"."site_documents_sections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"heading" varchar
  );
  
  CREATE TABLE "website"."site_documents_full_sections_paragraphs" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "website"."site_documents_full_sections_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "website"."site_documents_full_sections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"heading" varchar
  );
  
  CREATE TABLE "website"."site_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" "website"."enum_site_documents_slug",
  	"eyebrow" varchar,
  	"title" varchar,
  	"summary" varchar,
  	"meta" varchar,
  	"source" varchar,
  	"closing" varchar,
  	"full_title" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "website"."enum_site_documents_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "website"."_site_documents_v_version_guide" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v_version_sections_paragraphs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v_version_sections_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v_version_sections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"heading" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v_version_full_sections_paragraphs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v_version_full_sections_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"text" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v_version_full_sections" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"heading" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_documents_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_slug" "website"."enum__site_documents_v_version_slug",
  	"version_eyebrow" varchar,
  	"version_title" varchar,
  	"version_summary" varchar,
  	"version_meta" varchar,
  	"version_source" varchar,
  	"version_closing" varchar,
  	"version_full_title" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "website"."enum__site_documents_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "website"."form_links" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"purpose" "website"."enum_form_links_purpose" NOT NULL,
  	"url" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "website"."matrix_submissions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"cell_id" "website"."enum_matrix_submissions_cell_id" NOT NULL,
  	"content" varchar NOT NULL,
  	"author_name" varchar,
  	"contact" varchar,
  	"status" "website"."enum_matrix_submissions_status" DEFAULT 'pending' NOT NULL,
  	"review_note" varchar,
  	"ip_hash" varchar,
  	"user_agent" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "website"."payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "website"."payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "website"."payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"cms_admins_id" integer,
  	"site_documents_id" integer,
  	"form_links_id" integer,
  	"matrix_submissions_id" integer
  );
  
  CREATE TABLE "website"."payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "website"."payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"cms_admins_id" integer
  );
  
  CREATE TABLE "website"."payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "website"."homepage_dialogue_suggestions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"value" varchar
  );
  
  CREATE TABLE "website"."homepage_hero_flow" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "website"."homepage_identity_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "website"."homepage_why_now_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "website"."homepage_life_scenes_scenes_tags" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tag" varchar
  );
  
  CREATE TABLE "website"."homepage_life_scenes_scenes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "website"."homepage_direction_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "website"."homepage_self_restraint_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar
  );
  
  CREATE TABLE "website"."homepage_continue_reads_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"description" varchar,
  	"target" "website"."enum_homepage_continue_reads_items_target"
  );
  
  CREATE TABLE "website"."homepage" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"hero_kicker" varchar,
  	"hero_title" varchar,
  	"hero_organization_line" varchar,
  	"hero_manifesto_line" varchar,
  	"hero_body" varchar,
  	"dialogue_entry_prompt" varchar,
  	"dialogue_entry_placeholder" varchar,
  	"dialogue_entry_submit_label" varchar,
  	"dialogue_entry_note" varchar,
  	"identity_heading" varchar,
  	"identity_intro" varchar,
  	"why_now_heading" varchar,
  	"why_now_intro" varchar,
  	"life_scenes_heading" varchar,
  	"life_scenes_intro" varchar,
  	"direction_heading" varchar,
  	"direction_intro" varchar,
  	"self_restraint_heading" varchar,
  	"self_restraint_intro" varchar,
  	"continue_reads_heading" varchar,
  	"continue_reads_intro" varchar,
  	"_status" "website"."enum_homepage_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "website"."_homepage_v_version_dialogue_suggestions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"value" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_hero_flow" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_identity_cards" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_why_now_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_life_scenes_scenes_tags" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"tag" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_life_scenes_scenes" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_direction_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_self_restraint_points" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"body" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v_version_continue_reads_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"description" varchar,
  	"target" "website"."enum__homepage_v_version_continue_reads_items_target",
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_homepage_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_hero_kicker" varchar,
  	"version_hero_title" varchar,
  	"version_hero_organization_line" varchar,
  	"version_hero_manifesto_line" varchar,
  	"version_hero_body" varchar,
  	"version_dialogue_entry_prompt" varchar,
  	"version_dialogue_entry_placeholder" varchar,
  	"version_dialogue_entry_submit_label" varchar,
  	"version_dialogue_entry_note" varchar,
  	"version_identity_heading" varchar,
  	"version_identity_intro" varchar,
  	"version_why_now_heading" varchar,
  	"version_why_now_intro" varchar,
  	"version_life_scenes_heading" varchar,
  	"version_life_scenes_intro" varchar,
  	"version_direction_heading" varchar,
  	"version_direction_intro" varchar,
  	"version_self_restraint_heading" varchar,
  	"version_self_restraint_intro" varchar,
  	"version_continue_reads_heading" varchar,
  	"version_continue_reads_intro" varchar,
  	"version__status" "website"."enum__homepage_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "website"."chat_page" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"heading" varchar,
  	"intro" varchar,
  	"_status" "website"."enum_chat_page_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "website"."_chat_page_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_heading" varchar,
  	"version_intro" varchar,
  	"version__status" "website"."enum__chat_page_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "website"."ui_strings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"back_to_home" varchar,
  	"send_label" varchar,
  	"chat_restart" varchar,
  	"chat_loading" varchar,
  	"chat_disclaimer" varchar,
  	"chat_assistant_name" varchar,
  	"chat_user_name" varchar,
  	"chat_placeholder" varchar,
  	"chat_reset_confirm" varchar,
  	"_status" "website"."enum_ui_strings_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "website"."_ui_strings_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_back_to_home" varchar,
  	"version_send_label" varchar,
  	"version_chat_restart" varchar,
  	"version_chat_loading" varchar,
  	"version_chat_disclaimer" varchar,
  	"version_chat_assistant_name" varchar,
  	"version_chat_user_name" varchar,
  	"version_chat_placeholder" varchar,
  	"version_chat_reset_confirm" varchar,
  	"version__status" "website"."enum__ui_strings_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "website"."site_settings_header_nav" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "website"."site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"share_title" varchar,
  	"share_description" varchar,
  	"direction_map_url" varchar,
  	"github_url" varchar,
  	"brand_wordmark" varchar,
  	"brand_tagline" varchar,
  	"brand_logo_path" varchar,
  	"brand_logo_alt" varchar,
  	"_status" "website"."enum_site_settings_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "website"."_site_settings_v_version_header_nav" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_site_settings_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_share_title" varchar,
  	"version_share_description" varchar,
  	"version_direction_map_url" varchar,
  	"version_github_url" varchar,
  	"version_brand_wordmark" varchar,
  	"version_brand_tagline" varchar,
  	"version_brand_logo_path" varchar,
  	"version_brand_logo_alt" varchar,
  	"version__status" "website"."enum__site_settings_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "website"."footer_footer_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar
  );
  
  CREATE TABLE "website"."footer_channels" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"icon_key" "website"."enum_footer_channels_icon_key",
  	"status" varchar,
  	"description" varchar,
  	"qr_path" varchar,
  	"qr_alt" varchar
  );
  
  CREATE TABLE "website"."footer" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"description" varchar,
  	"links_heading" varchar,
  	"channels_heading" varchar,
  	"github_label" varchar,
  	"beian" varchar,
  	"copyright" varchar,
  	"_status" "website"."enum_footer_status" DEFAULT 'draft',
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "website"."_footer_v_version_footer_links" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"href" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_footer_v_version_channels" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar,
  	"icon_key" "website"."enum__footer_v_version_channels_icon_key",
  	"status" varchar,
  	"description" varchar,
  	"qr_path" varchar,
  	"qr_alt" varchar,
  	"_uuid" varchar
  );
  
  CREATE TABLE "website"."_footer_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_description" varchar,
  	"version_links_heading" varchar,
  	"version_channels_heading" varchar,
  	"version_github_label" varchar,
  	"version_beian" varchar,
  	"version_copyright" varchar,
  	"version__status" "website"."enum__footer_v_version_status" DEFAULT 'draft',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  ALTER TABLE "website"."cms_admins_sessions" ADD CONSTRAINT "cms_admins_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."cms_admins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_guide" ADD CONSTRAINT "site_documents_guide_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_sections_paragraphs" ADD CONSTRAINT "site_documents_sections_paragraphs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_sections_points" ADD CONSTRAINT "site_documents_sections_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_sections" ADD CONSTRAINT "site_documents_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_full_sections_paragraphs" ADD CONSTRAINT "site_documents_full_sections_paragraphs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents_full_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_full_sections_points" ADD CONSTRAINT "site_documents_full_sections_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents_full_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_documents_full_sections" ADD CONSTRAINT "site_documents_full_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_guide" ADD CONSTRAINT "_site_documents_v_version_guide_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_sections_paragraphs" ADD CONSTRAINT "_site_documents_v_version_sections_paragraphs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v_version_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_sections_points" ADD CONSTRAINT "_site_documents_v_version_sections_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v_version_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_sections" ADD CONSTRAINT "_site_documents_v_version_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_full_sections_paragraphs" ADD CONSTRAINT "_site_documents_v_version_full_sections_paragraphs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v_version_full_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_full_sections_points" ADD CONSTRAINT "_site_documents_v_version_full_sections_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v_version_full_sections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v_version_full_sections" ADD CONSTRAINT "_site_documents_v_version_full_sections_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_documents_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_documents_v" ADD CONSTRAINT "_site_documents_v_parent_id_site_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "website"."site_documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "website"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "website"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cms_admins_fk" FOREIGN KEY ("cms_admins_id") REFERENCES "website"."cms_admins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_site_documents_fk" FOREIGN KEY ("site_documents_id") REFERENCES "website"."site_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_form_links_fk" FOREIGN KEY ("form_links_id") REFERENCES "website"."form_links"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_matrix_submissions_fk" FOREIGN KEY ("matrix_submissions_id") REFERENCES "website"."matrix_submissions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "website"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_cms_admins_fk" FOREIGN KEY ("cms_admins_id") REFERENCES "website"."cms_admins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_dialogue_suggestions" ADD CONSTRAINT "homepage_dialogue_suggestions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_hero_flow" ADD CONSTRAINT "homepage_hero_flow_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_identity_cards" ADD CONSTRAINT "homepage_identity_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_why_now_points" ADD CONSTRAINT "homepage_why_now_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_life_scenes_scenes_tags" ADD CONSTRAINT "homepage_life_scenes_scenes_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage_life_scenes_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_life_scenes_scenes" ADD CONSTRAINT "homepage_life_scenes_scenes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_direction_points" ADD CONSTRAINT "homepage_direction_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_self_restraint_points" ADD CONSTRAINT "homepage_self_restraint_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."homepage_continue_reads_items" ADD CONSTRAINT "homepage_continue_reads_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."homepage"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_dialogue_suggestions" ADD CONSTRAINT "_homepage_v_version_dialogue_suggestions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_hero_flow" ADD CONSTRAINT "_homepage_v_version_hero_flow_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_identity_cards" ADD CONSTRAINT "_homepage_v_version_identity_cards_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_why_now_points" ADD CONSTRAINT "_homepage_v_version_why_now_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_life_scenes_scenes_tags" ADD CONSTRAINT "_homepage_v_version_life_scenes_scenes_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v_version_life_scenes_scenes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_life_scenes_scenes" ADD CONSTRAINT "_homepage_v_version_life_scenes_scenes_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_direction_points" ADD CONSTRAINT "_homepage_v_version_direction_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_self_restraint_points" ADD CONSTRAINT "_homepage_v_version_self_restraint_points_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_homepage_v_version_continue_reads_items" ADD CONSTRAINT "_homepage_v_version_continue_reads_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_homepage_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."site_settings_header_nav" ADD CONSTRAINT "site_settings_header_nav_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_site_settings_v_version_header_nav" ADD CONSTRAINT "_site_settings_v_version_header_nav_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_site_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."footer_footer_links" ADD CONSTRAINT "footer_footer_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."footer_channels" ADD CONSTRAINT "footer_channels_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."footer"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_footer_v_version_footer_links" ADD CONSTRAINT "_footer_v_version_footer_links_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_footer_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "website"."_footer_v_version_channels" ADD CONSTRAINT "_footer_v_version_channels_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "website"."_footer_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "cms_admins_sessions_order_idx" ON "website"."cms_admins_sessions" USING btree ("_order");
  CREATE INDEX "cms_admins_sessions_parent_id_idx" ON "website"."cms_admins_sessions" USING btree ("_parent_id");
  CREATE INDEX "cms_admins_updated_at_idx" ON "website"."cms_admins" USING btree ("updated_at");
  CREATE INDEX "cms_admins_created_at_idx" ON "website"."cms_admins" USING btree ("created_at");
  CREATE UNIQUE INDEX "cms_admins_email_idx" ON "website"."cms_admins" USING btree ("email");
  CREATE INDEX "site_documents_guide_order_idx" ON "website"."site_documents_guide" USING btree ("_order");
  CREATE INDEX "site_documents_guide_parent_id_idx" ON "website"."site_documents_guide" USING btree ("_parent_id");
  CREATE INDEX "site_documents_sections_paragraphs_order_idx" ON "website"."site_documents_sections_paragraphs" USING btree ("_order");
  CREATE INDEX "site_documents_sections_paragraphs_parent_id_idx" ON "website"."site_documents_sections_paragraphs" USING btree ("_parent_id");
  CREATE INDEX "site_documents_sections_points_order_idx" ON "website"."site_documents_sections_points" USING btree ("_order");
  CREATE INDEX "site_documents_sections_points_parent_id_idx" ON "website"."site_documents_sections_points" USING btree ("_parent_id");
  CREATE INDEX "site_documents_sections_order_idx" ON "website"."site_documents_sections" USING btree ("_order");
  CREATE INDEX "site_documents_sections_parent_id_idx" ON "website"."site_documents_sections" USING btree ("_parent_id");
  CREATE INDEX "site_documents_full_sections_paragraphs_order_idx" ON "website"."site_documents_full_sections_paragraphs" USING btree ("_order");
  CREATE INDEX "site_documents_full_sections_paragraphs_parent_id_idx" ON "website"."site_documents_full_sections_paragraphs" USING btree ("_parent_id");
  CREATE INDEX "site_documents_full_sections_points_order_idx" ON "website"."site_documents_full_sections_points" USING btree ("_order");
  CREATE INDEX "site_documents_full_sections_points_parent_id_idx" ON "website"."site_documents_full_sections_points" USING btree ("_parent_id");
  CREATE INDEX "site_documents_full_sections_order_idx" ON "website"."site_documents_full_sections" USING btree ("_order");
  CREATE INDEX "site_documents_full_sections_parent_id_idx" ON "website"."site_documents_full_sections" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "site_documents_slug_idx" ON "website"."site_documents" USING btree ("slug");
  CREATE INDEX "site_documents_updated_at_idx" ON "website"."site_documents" USING btree ("updated_at");
  CREATE INDEX "site_documents_created_at_idx" ON "website"."site_documents" USING btree ("created_at");
  CREATE INDEX "site_documents__status_idx" ON "website"."site_documents" USING btree ("_status");
  CREATE INDEX "_site_documents_v_version_guide_order_idx" ON "website"."_site_documents_v_version_guide" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_guide_parent_id_idx" ON "website"."_site_documents_v_version_guide" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_version_sections_paragraphs_order_idx" ON "website"."_site_documents_v_version_sections_paragraphs" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_sections_paragraphs_parent_id_idx" ON "website"."_site_documents_v_version_sections_paragraphs" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_version_sections_points_order_idx" ON "website"."_site_documents_v_version_sections_points" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_sections_points_parent_id_idx" ON "website"."_site_documents_v_version_sections_points" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_version_sections_order_idx" ON "website"."_site_documents_v_version_sections" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_sections_parent_id_idx" ON "website"."_site_documents_v_version_sections" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_version_full_sections_paragraphs_order_idx" ON "website"."_site_documents_v_version_full_sections_paragraphs" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_full_sections_paragraphs_parent_id_idx" ON "website"."_site_documents_v_version_full_sections_paragraphs" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_version_full_sections_points_order_idx" ON "website"."_site_documents_v_version_full_sections_points" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_full_sections_points_parent_id_idx" ON "website"."_site_documents_v_version_full_sections_points" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_version_full_sections_order_idx" ON "website"."_site_documents_v_version_full_sections" USING btree ("_order");
  CREATE INDEX "_site_documents_v_version_full_sections_parent_id_idx" ON "website"."_site_documents_v_version_full_sections" USING btree ("_parent_id");
  CREATE INDEX "_site_documents_v_parent_idx" ON "website"."_site_documents_v" USING btree ("parent_id");
  CREATE INDEX "_site_documents_v_version_version_slug_idx" ON "website"."_site_documents_v" USING btree ("version_slug");
  CREATE INDEX "_site_documents_v_version_version_updated_at_idx" ON "website"."_site_documents_v" USING btree ("version_updated_at");
  CREATE INDEX "_site_documents_v_version_version_created_at_idx" ON "website"."_site_documents_v" USING btree ("version_created_at");
  CREATE INDEX "_site_documents_v_version_version__status_idx" ON "website"."_site_documents_v" USING btree ("version__status");
  CREATE INDEX "_site_documents_v_created_at_idx" ON "website"."_site_documents_v" USING btree ("created_at");
  CREATE INDEX "_site_documents_v_updated_at_idx" ON "website"."_site_documents_v" USING btree ("updated_at");
  CREATE INDEX "_site_documents_v_latest_idx" ON "website"."_site_documents_v" USING btree ("latest");
  CREATE INDEX "form_links_updated_at_idx" ON "website"."form_links" USING btree ("updated_at");
  CREATE INDEX "form_links_created_at_idx" ON "website"."form_links" USING btree ("created_at");
  CREATE INDEX "matrix_submissions_cell_id_idx" ON "website"."matrix_submissions" USING btree ("cell_id");
  CREATE INDEX "matrix_submissions_status_idx" ON "website"."matrix_submissions" USING btree ("status");
  CREATE INDEX "matrix_submissions_updated_at_idx" ON "website"."matrix_submissions" USING btree ("updated_at");
  CREATE INDEX "matrix_submissions_created_at_idx" ON "website"."matrix_submissions" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "website"."payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "website"."payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "website"."payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "website"."payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "website"."payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "website"."payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "website"."payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_cms_admins_id_idx" ON "website"."payload_locked_documents_rels" USING btree ("cms_admins_id");
  CREATE INDEX "payload_locked_documents_rels_site_documents_id_idx" ON "website"."payload_locked_documents_rels" USING btree ("site_documents_id");
  CREATE INDEX "payload_locked_documents_rels_form_links_id_idx" ON "website"."payload_locked_documents_rels" USING btree ("form_links_id");
  CREATE INDEX "payload_locked_documents_rels_matrix_submissions_id_idx" ON "website"."payload_locked_documents_rels" USING btree ("matrix_submissions_id");
  CREATE INDEX "payload_preferences_key_idx" ON "website"."payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "website"."payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "website"."payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "website"."payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "website"."payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "website"."payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_cms_admins_id_idx" ON "website"."payload_preferences_rels" USING btree ("cms_admins_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "website"."payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "website"."payload_migrations" USING btree ("created_at");
  CREATE INDEX "homepage_dialogue_suggestions_order_idx" ON "website"."homepage_dialogue_suggestions" USING btree ("_order");
  CREATE INDEX "homepage_dialogue_suggestions_parent_id_idx" ON "website"."homepage_dialogue_suggestions" USING btree ("_parent_id");
  CREATE INDEX "homepage_hero_flow_order_idx" ON "website"."homepage_hero_flow" USING btree ("_order");
  CREATE INDEX "homepage_hero_flow_parent_id_idx" ON "website"."homepage_hero_flow" USING btree ("_parent_id");
  CREATE INDEX "homepage_identity_cards_order_idx" ON "website"."homepage_identity_cards" USING btree ("_order");
  CREATE INDEX "homepage_identity_cards_parent_id_idx" ON "website"."homepage_identity_cards" USING btree ("_parent_id");
  CREATE INDEX "homepage_why_now_points_order_idx" ON "website"."homepage_why_now_points" USING btree ("_order");
  CREATE INDEX "homepage_why_now_points_parent_id_idx" ON "website"."homepage_why_now_points" USING btree ("_parent_id");
  CREATE INDEX "homepage_life_scenes_scenes_tags_order_idx" ON "website"."homepage_life_scenes_scenes_tags" USING btree ("_order");
  CREATE INDEX "homepage_life_scenes_scenes_tags_parent_id_idx" ON "website"."homepage_life_scenes_scenes_tags" USING btree ("_parent_id");
  CREATE INDEX "homepage_life_scenes_scenes_order_idx" ON "website"."homepage_life_scenes_scenes" USING btree ("_order");
  CREATE INDEX "homepage_life_scenes_scenes_parent_id_idx" ON "website"."homepage_life_scenes_scenes" USING btree ("_parent_id");
  CREATE INDEX "homepage_direction_points_order_idx" ON "website"."homepage_direction_points" USING btree ("_order");
  CREATE INDEX "homepage_direction_points_parent_id_idx" ON "website"."homepage_direction_points" USING btree ("_parent_id");
  CREATE INDEX "homepage_self_restraint_points_order_idx" ON "website"."homepage_self_restraint_points" USING btree ("_order");
  CREATE INDEX "homepage_self_restraint_points_parent_id_idx" ON "website"."homepage_self_restraint_points" USING btree ("_parent_id");
  CREATE INDEX "homepage_continue_reads_items_order_idx" ON "website"."homepage_continue_reads_items" USING btree ("_order");
  CREATE INDEX "homepage_continue_reads_items_parent_id_idx" ON "website"."homepage_continue_reads_items" USING btree ("_parent_id");
  CREATE INDEX "homepage__status_idx" ON "website"."homepage" USING btree ("_status");
  CREATE INDEX "_homepage_v_version_dialogue_suggestions_order_idx" ON "website"."_homepage_v_version_dialogue_suggestions" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_dialogue_suggestions_parent_id_idx" ON "website"."_homepage_v_version_dialogue_suggestions" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_hero_flow_order_idx" ON "website"."_homepage_v_version_hero_flow" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_hero_flow_parent_id_idx" ON "website"."_homepage_v_version_hero_flow" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_identity_cards_order_idx" ON "website"."_homepage_v_version_identity_cards" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_identity_cards_parent_id_idx" ON "website"."_homepage_v_version_identity_cards" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_why_now_points_order_idx" ON "website"."_homepage_v_version_why_now_points" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_why_now_points_parent_id_idx" ON "website"."_homepage_v_version_why_now_points" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_life_scenes_scenes_tags_order_idx" ON "website"."_homepage_v_version_life_scenes_scenes_tags" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_life_scenes_scenes_tags_parent_id_idx" ON "website"."_homepage_v_version_life_scenes_scenes_tags" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_life_scenes_scenes_order_idx" ON "website"."_homepage_v_version_life_scenes_scenes" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_life_scenes_scenes_parent_id_idx" ON "website"."_homepage_v_version_life_scenes_scenes" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_direction_points_order_idx" ON "website"."_homepage_v_version_direction_points" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_direction_points_parent_id_idx" ON "website"."_homepage_v_version_direction_points" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_self_restraint_points_order_idx" ON "website"."_homepage_v_version_self_restraint_points" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_self_restraint_points_parent_id_idx" ON "website"."_homepage_v_version_self_restraint_points" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_continue_reads_items_order_idx" ON "website"."_homepage_v_version_continue_reads_items" USING btree ("_order");
  CREATE INDEX "_homepage_v_version_continue_reads_items_parent_id_idx" ON "website"."_homepage_v_version_continue_reads_items" USING btree ("_parent_id");
  CREATE INDEX "_homepage_v_version_version__status_idx" ON "website"."_homepage_v" USING btree ("version__status");
  CREATE INDEX "_homepage_v_created_at_idx" ON "website"."_homepage_v" USING btree ("created_at");
  CREATE INDEX "_homepage_v_updated_at_idx" ON "website"."_homepage_v" USING btree ("updated_at");
  CREATE INDEX "_homepage_v_latest_idx" ON "website"."_homepage_v" USING btree ("latest");
  CREATE INDEX "chat_page__status_idx" ON "website"."chat_page" USING btree ("_status");
  CREATE INDEX "_chat_page_v_version_version__status_idx" ON "website"."_chat_page_v" USING btree ("version__status");
  CREATE INDEX "_chat_page_v_created_at_idx" ON "website"."_chat_page_v" USING btree ("created_at");
  CREATE INDEX "_chat_page_v_updated_at_idx" ON "website"."_chat_page_v" USING btree ("updated_at");
  CREATE INDEX "_chat_page_v_latest_idx" ON "website"."_chat_page_v" USING btree ("latest");
  CREATE INDEX "ui_strings__status_idx" ON "website"."ui_strings" USING btree ("_status");
  CREATE INDEX "_ui_strings_v_version_version__status_idx" ON "website"."_ui_strings_v" USING btree ("version__status");
  CREATE INDEX "_ui_strings_v_created_at_idx" ON "website"."_ui_strings_v" USING btree ("created_at");
  CREATE INDEX "_ui_strings_v_updated_at_idx" ON "website"."_ui_strings_v" USING btree ("updated_at");
  CREATE INDEX "_ui_strings_v_latest_idx" ON "website"."_ui_strings_v" USING btree ("latest");
  CREATE INDEX "site_settings_header_nav_order_idx" ON "website"."site_settings_header_nav" USING btree ("_order");
  CREATE INDEX "site_settings_header_nav_parent_id_idx" ON "website"."site_settings_header_nav" USING btree ("_parent_id");
  CREATE INDEX "site_settings__status_idx" ON "website"."site_settings" USING btree ("_status");
  CREATE INDEX "_site_settings_v_version_header_nav_order_idx" ON "website"."_site_settings_v_version_header_nav" USING btree ("_order");
  CREATE INDEX "_site_settings_v_version_header_nav_parent_id_idx" ON "website"."_site_settings_v_version_header_nav" USING btree ("_parent_id");
  CREATE INDEX "_site_settings_v_version_version__status_idx" ON "website"."_site_settings_v" USING btree ("version__status");
  CREATE INDEX "_site_settings_v_created_at_idx" ON "website"."_site_settings_v" USING btree ("created_at");
  CREATE INDEX "_site_settings_v_updated_at_idx" ON "website"."_site_settings_v" USING btree ("updated_at");
  CREATE INDEX "_site_settings_v_latest_idx" ON "website"."_site_settings_v" USING btree ("latest");
  CREATE INDEX "footer_footer_links_order_idx" ON "website"."footer_footer_links" USING btree ("_order");
  CREATE INDEX "footer_footer_links_parent_id_idx" ON "website"."footer_footer_links" USING btree ("_parent_id");
  CREATE INDEX "footer_channels_order_idx" ON "website"."footer_channels" USING btree ("_order");
  CREATE INDEX "footer_channels_parent_id_idx" ON "website"."footer_channels" USING btree ("_parent_id");
  CREATE INDEX "footer__status_idx" ON "website"."footer" USING btree ("_status");
  CREATE INDEX "_footer_v_version_footer_links_order_idx" ON "website"."_footer_v_version_footer_links" USING btree ("_order");
  CREATE INDEX "_footer_v_version_footer_links_parent_id_idx" ON "website"."_footer_v_version_footer_links" USING btree ("_parent_id");
  CREATE INDEX "_footer_v_version_channels_order_idx" ON "website"."_footer_v_version_channels" USING btree ("_order");
  CREATE INDEX "_footer_v_version_channels_parent_id_idx" ON "website"."_footer_v_version_channels" USING btree ("_parent_id");
  CREATE INDEX "_footer_v_version_version__status_idx" ON "website"."_footer_v" USING btree ("version__status");
  CREATE INDEX "_footer_v_created_at_idx" ON "website"."_footer_v" USING btree ("created_at");
  CREATE INDEX "_footer_v_updated_at_idx" ON "website"."_footer_v" USING btree ("updated_at");
  CREATE INDEX "_footer_v_latest_idx" ON "website"."_footer_v" USING btree ("latest");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "website"."cms_admins_sessions" CASCADE;
  DROP TABLE "website"."cms_admins" CASCADE;
  DROP TABLE "website"."site_documents_guide" CASCADE;
  DROP TABLE "website"."site_documents_sections_paragraphs" CASCADE;
  DROP TABLE "website"."site_documents_sections_points" CASCADE;
  DROP TABLE "website"."site_documents_sections" CASCADE;
  DROP TABLE "website"."site_documents_full_sections_paragraphs" CASCADE;
  DROP TABLE "website"."site_documents_full_sections_points" CASCADE;
  DROP TABLE "website"."site_documents_full_sections" CASCADE;
  DROP TABLE "website"."site_documents" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_guide" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_sections_paragraphs" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_sections_points" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_sections" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_full_sections_paragraphs" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_full_sections_points" CASCADE;
  DROP TABLE "website"."_site_documents_v_version_full_sections" CASCADE;
  DROP TABLE "website"."_site_documents_v" CASCADE;
  DROP TABLE "website"."form_links" CASCADE;
  DROP TABLE "website"."matrix_submissions" CASCADE;
  DROP TABLE "website"."payload_kv" CASCADE;
  DROP TABLE "website"."payload_locked_documents" CASCADE;
  DROP TABLE "website"."payload_locked_documents_rels" CASCADE;
  DROP TABLE "website"."payload_preferences" CASCADE;
  DROP TABLE "website"."payload_preferences_rels" CASCADE;
  DROP TABLE "website"."payload_migrations" CASCADE;
  DROP TABLE "website"."homepage_dialogue_suggestions" CASCADE;
  DROP TABLE "website"."homepage_hero_flow" CASCADE;
  DROP TABLE "website"."homepage_identity_cards" CASCADE;
  DROP TABLE "website"."homepage_why_now_points" CASCADE;
  DROP TABLE "website"."homepage_life_scenes_scenes_tags" CASCADE;
  DROP TABLE "website"."homepage_life_scenes_scenes" CASCADE;
  DROP TABLE "website"."homepage_direction_points" CASCADE;
  DROP TABLE "website"."homepage_self_restraint_points" CASCADE;
  DROP TABLE "website"."homepage_continue_reads_items" CASCADE;
  DROP TABLE "website"."homepage" CASCADE;
  DROP TABLE "website"."_homepage_v_version_dialogue_suggestions" CASCADE;
  DROP TABLE "website"."_homepage_v_version_hero_flow" CASCADE;
  DROP TABLE "website"."_homepage_v_version_identity_cards" CASCADE;
  DROP TABLE "website"."_homepage_v_version_why_now_points" CASCADE;
  DROP TABLE "website"."_homepage_v_version_life_scenes_scenes_tags" CASCADE;
  DROP TABLE "website"."_homepage_v_version_life_scenes_scenes" CASCADE;
  DROP TABLE "website"."_homepage_v_version_direction_points" CASCADE;
  DROP TABLE "website"."_homepage_v_version_self_restraint_points" CASCADE;
  DROP TABLE "website"."_homepage_v_version_continue_reads_items" CASCADE;
  DROP TABLE "website"."_homepage_v" CASCADE;
  DROP TABLE "website"."chat_page" CASCADE;
  DROP TABLE "website"."_chat_page_v" CASCADE;
  DROP TABLE "website"."ui_strings" CASCADE;
  DROP TABLE "website"."_ui_strings_v" CASCADE;
  DROP TABLE "website"."site_settings_header_nav" CASCADE;
  DROP TABLE "website"."site_settings" CASCADE;
  DROP TABLE "website"."_site_settings_v_version_header_nav" CASCADE;
  DROP TABLE "website"."_site_settings_v" CASCADE;
  DROP TABLE "website"."footer_footer_links" CASCADE;
  DROP TABLE "website"."footer_channels" CASCADE;
  DROP TABLE "website"."footer" CASCADE;
  DROP TABLE "website"."_footer_v_version_footer_links" CASCADE;
  DROP TABLE "website"."_footer_v_version_channels" CASCADE;
  DROP TABLE "website"."_footer_v" CASCADE;
  DROP TYPE "website"."enum_site_documents_slug";
  DROP TYPE "website"."enum_site_documents_status";
  DROP TYPE "website"."enum__site_documents_v_version_slug";
  DROP TYPE "website"."enum__site_documents_v_version_status";
  DROP TYPE "website"."enum_form_links_purpose";
  DROP TYPE "website"."enum_matrix_submissions_cell_id";
  DROP TYPE "website"."enum_matrix_submissions_status";
  DROP TYPE "website"."enum_homepage_continue_reads_items_target";
  DROP TYPE "website"."enum_homepage_status";
  DROP TYPE "website"."enum__homepage_v_version_continue_reads_items_target";
  DROP TYPE "website"."enum__homepage_v_version_status";
  DROP TYPE "website"."enum_chat_page_status";
  DROP TYPE "website"."enum__chat_page_v_version_status";
  DROP TYPE "website"."enum_ui_strings_status";
  DROP TYPE "website"."enum__ui_strings_v_version_status";
  DROP TYPE "website"."enum_site_settings_status";
  DROP TYPE "website"."enum__site_settings_v_version_status";
  DROP TYPE "website"."enum_footer_channels_icon_key";
  DROP TYPE "website"."enum_footer_status";
  DROP TYPE "website"."enum__footer_v_version_channels_icon_key";
  DROP TYPE "website"."enum__footer_v_version_status";
  DROP SCHEMA IF EXISTS "website" CASCADE;`)
}
