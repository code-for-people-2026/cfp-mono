import * as migration_20261023_122805_identity_schema from './20261023_122805_identity_schema';

export const migrations = [
  {
    up: migration_20261023_122805_identity_schema.up,
    down: migration_20261023_122805_identity_schema.down,
    name: '20261023_122805_identity_schema'
  },
];
