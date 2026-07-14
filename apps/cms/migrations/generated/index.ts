import * as migration_20260714_105116_initial_cms_schema from './20260714_105116_initial_cms_schema';

export const migrations = [
  {
    up: migration_20260714_105116_initial_cms_schema.up,
    down: migration_20260714_105116_initial_cms_schema.down,
    name: '20260714_105116_initial_cms_schema'
  },
];
