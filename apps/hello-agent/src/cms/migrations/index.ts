import * as profile from "./20261014_080000_wechat_profile";
import * as age from "./20261013_181500_wechat_age_verification";
import * as privacyHistory from "./20261013_175000_privacy_history_inspection";
import * as privacyRevision from "./20261013_174000_privacy_revision";
import * as privacy from './20261013_151000_privacy_lifecycle';
import * as migration_20260930_123608_initial_preview from './20260930_123608_initial_preview';
import * as migration_20261002_014226_private_image_objects from './20261002_014226_private_image_objects';
import * as migration_20261010_060548_response_artifacts from './20261010_060548_response_artifacts';
import * as migration_20261012_035545_agent_configuration from './20261012_035545_agent_configuration';
import * as migration_20261013_125923_platform_model_quota from './20261013_125923_platform_model_quota';

export const migrations = [
  {
    up: migration_20260930_123608_initial_preview.up,
    down: migration_20260930_123608_initial_preview.down,
    name: '20260930_123608_initial_preview',
  },
  {
    up: migration_20261002_014226_private_image_objects.up,
    down: migration_20261002_014226_private_image_objects.down,
    name: '20261002_014226_private_image_objects',
  },
  {
    up: migration_20261010_060548_response_artifacts.up,
    down: migration_20261010_060548_response_artifacts.down,
    name: '20261010_060548_response_artifacts',
  },
  {
    up: migration_20261012_035545_agent_configuration.up,
    down: migration_20261012_035545_agent_configuration.down,
    name: '20261012_035545_agent_configuration',
  },
  {
    up: migration_20261013_125923_platform_model_quota.up,
    down: migration_20261013_125923_platform_model_quota.down,
    name: '20261013_125923_platform_model_quota'
  },
  { up: privacy.up, down: privacy.down, name: "20261013_151000_privacy_lifecycle" },
  { up: privacyRevision.up, down: privacyRevision.down, name: "20261013_174000_privacy_revision" },
  { up: privacyHistory.up, down: privacyHistory.down, name: "20261013_175000_privacy_history_inspection" },
  { up: age.up, down: age.down, name: "20261013_181500_wechat_age_verification" },
  { up: profile.up, down: profile.down, name: "20261014_080000_wechat_profile" },
];
