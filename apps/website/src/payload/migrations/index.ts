import * as migration_20260624_070826_initial_website_schema from './20260624_070826_initial_website_schema';
import * as migration_20260624_084514_recipes from './20260624_084514_recipes';

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
];
