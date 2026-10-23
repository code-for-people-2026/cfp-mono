import * as migration_20261023_122805_identity_schema from './20261023_122805_identity_schema';
import * as migration_20261023_125354_care_records from './20261023_125354_care_records';
import * as migration_20261023_132619_private_chat from './20261023_132619_private_chat';
import * as migration_20261023_140114_ops_admin from './20261023_140114_ops_admin';
import * as migration_20261023_143630_membership_service from './20261023_143630_membership_service';

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
    name: '20261023_132619_private_chat',
  },
  {
    up: migration_20261023_140114_ops_admin.up,
    down: migration_20261023_140114_ops_admin.down,
    name: '20261023_140114_ops_admin',
  },
  {
    up: migration_20261023_143630_membership_service.up,
    down: migration_20261023_143630_membership_service.down,
    name: '20261023_143630_membership_service'
  },
];
