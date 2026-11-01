import * as migration_20261023_122805_identity_schema from './20261023_122805_identity_schema';
import * as migration_20261023_125354_care_records from './20261023_125354_care_records';
import * as migration_20261023_132619_private_chat from './20261023_132619_private_chat';

export const migrations = [
  {
    up: migration_20261023_122805_identity_schema.up,
    down: migration_20261023_122805_identity_schema.down,
    name: '20261023_122805_identity_schema',
  },
  {
    up: migration_20261023_125354_care_records.up,
    down: migration_20261023_125354_care_records.down,
    name: '20261023_125354_care_records',
  },
  {
    up: migration_20261023_132619_private_chat.up,
    down: migration_20261023_132619_private_chat.down,
    name: '20261023_132619_private_chat'
  },
];
