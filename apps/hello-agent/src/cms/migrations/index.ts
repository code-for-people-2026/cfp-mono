import * as migration_20260930_123608_initial_preview from './20260930_123608_initial_preview';
import * as migration_20261002_014226_private_image_objects from './20261002_014226_private_image_objects';

export const migrations = [
  {
    up: migration_20260930_123608_initial_preview.up,
    down: migration_20260930_123608_initial_preview.down,
    name: '20260930_123608_initial_preview',
  },
  {
    up: migration_20261002_014226_private_image_objects.up,
    down: migration_20261002_014226_private_image_objects.down,
    name: '20261002_014226_private_image_objects'
  },
];
