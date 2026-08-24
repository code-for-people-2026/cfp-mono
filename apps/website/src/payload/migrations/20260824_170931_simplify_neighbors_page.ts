import { MigrateDownArgs, MigrateUpArgs, sql } from "@payloadcms/db-postgres";
import { neighborsPage } from "../../content/neighbors";

// Keep the already-deployed Preview database in sync with the shorter, visitor-facing
// page. The older section columns stay in place for a safe rollback, but are no longer
// exposed by Payload or rendered by the site.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "website"."site_content"
      ADD COLUMN "neighbors_page_responsibility_example_heading" varchar,
      ADD COLUMN "neighbors_page_responsibility_example_request" varchar,
      ADD COLUMN "neighbors_page_responsibility_example_items" jsonb DEFAULT '[]'::jsonb;
  `);

  await db.execute(sql`
    UPDATE "website"."site_content"
    SET
      "neighbors_page_hero_stage_label" = ${neighborsPage.hero.stageLabel},
      "neighbors_page_hero_eyebrow" = ${neighborsPage.hero.eyebrow},
      "neighbors_page_hero_tagline" = ${neighborsPage.hero.tagline},
      "neighbors_page_hero_summary" = ${neighborsPage.hero.summary},
      "neighbors_page_hero_distinction" = ${neighborsPage.hero.distinction},
      "neighbors_page_hero_affiliation" = ${neighborsPage.hero.affiliation},
      "neighbors_page_cta_label" = ${neighborsPage.cta.label},
      "neighbors_page_cta_description" = ${neighborsPage.cta.description},
      "neighbors_page_how_it_works_heading" = ${neighborsPage.howItWorks.heading},
      "neighbors_page_how_it_works_intro" = ${neighborsPage.howItWorks.intro},
      "neighbors_page_how_it_works_items" = ${JSON.stringify(neighborsPage.howItWorks.items)}::jsonb,
      "neighbors_page_evidence_heading" = ${neighborsPage.evidence.heading},
      "neighbors_page_evidence_intro" = ${neighborsPage.evidence.intro},
      "neighbors_page_evidence_items" = ${JSON.stringify(neighborsPage.evidence.items)}::jsonb,
      "neighbors_page_responsibility_heading" = ${neighborsPage.responsibility.heading},
      "neighbors_page_responsibility_intro" = ${neighborsPage.responsibility.intro},
      "neighbors_page_responsibility_items" = ${JSON.stringify(neighborsPage.responsibility.items)}::jsonb,
      "neighbors_page_responsibility_example_heading" = ${neighborsPage.responsibility.example.heading},
      "neighbors_page_responsibility_example_request" = ${neighborsPage.responsibility.example.request},
      "neighbors_page_responsibility_example_items" = ${JSON.stringify(neighborsPage.responsibility.example.items)}::jsonb,
      "neighbors_page_prototype_eyebrow" = ${neighborsPage.prototype.eyebrow},
      "neighbors_page_prototype_heading" = ${neighborsPage.prototype.heading},
      "neighbors_page_prototype_intro" = ${neighborsPage.prototype.intro},
      "neighbors_page_prototype_notice" = ${neighborsPage.prototype.notice},
      "neighbors_page_related_reading_heading" = ${neighborsPage.relatedReading.heading},
      "neighbors_page_related_reading_intro" = ${neighborsPage.relatedReading.intro},
      "neighbors_page_related_reading_items" = ${JSON.stringify(neighborsPage.relatedReading.items)}::jsonb,
      "updated_at" = NOW();
  `);

  await db.execute(sql`
    ALTER TABLE "website"."site_content"
      ALTER COLUMN "neighbors_page_responsibility_example_heading" SET NOT NULL,
      ALTER COLUMN "neighbors_page_responsibility_example_request" SET NOT NULL;
  `);
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "website"."site_content"
      DROP COLUMN "neighbors_page_responsibility_example_heading",
      DROP COLUMN "neighbors_page_responsibility_example_request",
      DROP COLUMN "neighbors_page_responsibility_example_items";
  `);
}
