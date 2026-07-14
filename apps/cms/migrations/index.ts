import * as migration_20260714_110001_kith_inn_trial_baseline from './20260714_110001_kith_inn_trial_baseline';

export const migrations = [
  {
    up: migration_20260714_110001_kith_inn_trial_baseline.up,
    down: migration_20260714_110001_kith_inn_trial_baseline.down,
    name: '20260714_110001_kith_inn_trial_baseline'
  },
];
