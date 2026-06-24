import * as migration_20260624_070826_initial_website_schema from './20260624_070826_initial_website_schema';

export const migrations = [
  {
    up: migration_20260624_070826_initial_website_schema.up,
    down: migration_20260624_070826_initial_website_schema.down,
    name: '20260624_070826_initial_website_schema'
  },
];
