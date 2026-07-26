import * as migration_20260714_105116_initial_cms_schema from './20260714_105116_initial_cms_schema';
import * as migration_20260726_170151 from './20260726_170151';

export const migrations = [
  {
    up: migration_20260714_105116_initial_cms_schema.up,
    down: migration_20260714_105116_initial_cms_schema.down,
    name: '20260714_105116_initial_cms_schema',
  },
  {
    up: migration_20260726_170151.up,
    down: migration_20260726_170151.down,
    name: '20260726_170151'
  },
];
