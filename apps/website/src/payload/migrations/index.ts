import * as migration_20260624_070826_initial_website_schema from './20260624_070826_initial_website_schema';
import * as migration_20260624_084514_recipes from './20260624_084514_recipes';
import * as migration_20260627_223948_create_site_content from './20260627_223948_create_site_content';
import * as migration_20260627_223957_drop_legacy_content from './20260627_223957_drop_legacy_content';
import * as migration_20260721_040338_rename_website_brand from './20260721_040338_rename_website_brand';

export const migrations = [
  {
    up: migration_20260624_070826_initial_website_schema.up,
    down: migration_20260624_070826_initial_website_schema.down,
    name: '20260624_070826_initial_website_schema',
  },
  {
    up: migration_20260624_084514_recipes.up,
    down: migration_20260624_084514_recipes.down,
    name: '20260624_084514_recipes'
  },
  {
    up: migration_20260627_223948_create_site_content.up,
    down: migration_20260627_223948_create_site_content.down,
    name: '20260627_223948_create_site_content',
  },
  {
    up: migration_20260627_223957_drop_legacy_content.up,
    down: migration_20260627_223957_drop_legacy_content.down,
    name: '20260627_223957_drop_legacy_content',
  },
  {
    up: migration_20260721_040338_rename_website_brand.up,
    down: migration_20260721_040338_rename_website_brand.down,
    name: '20260721_040338_rename_website_brand',
  },
];
