import * as migration_20260930_123608_initial_preview from './20260930_123608_initial_preview';
import * as migration_20261002_014226_private_image_objects from './20261002_014226_private_image_objects';
import * as migration_20261010_060548_response_artifacts from './20261010_060548_response_artifacts';
import * as migration_20261012_035545_agent_configuration from './20261012_035545_agent_configuration';

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
    name: '20261012_035545_agent_configuration'
  },
];
