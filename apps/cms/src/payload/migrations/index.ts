import * as migration_20260702_094007_kith_inn_order_fulfillment_model from './20260702_094007_kith_inn_order_fulfillment_model';
import * as migration_20260703_000000_kith_inn_chat_message_card from './20260703_000000_kith_inn_chat_message_card';

export const migrations = [
  {
    up: migration_20260702_094007_kith_inn_order_fulfillment_model.up,
    down: migration_20260702_094007_kith_inn_order_fulfillment_model.down,
    name: '20260702_094007_kith_inn_order_fulfillment_model'
  },
  {
    up: migration_20260703_000000_kith_inn_chat_message_card.up,
    down: migration_20260703_000000_kith_inn_chat_message_card.down,
    name: '20260703_000000_kith_inn_chat_message_card'
  },
];
