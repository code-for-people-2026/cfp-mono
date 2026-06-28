import type { CollectionConfig } from "payload";
import { ChatMessages } from "./collections/ChatMessages";
import { CustomerAddresses } from "./collections/CustomerAddresses";
import { Customers } from "./collections/Customers";
import { Fulfillments } from "./collections/Fulfillments";
import { MenuPlans } from "./collections/MenuPlans";
import { Offerings } from "./collections/Offerings";
import { Operators } from "./collections/Operators";
import { OrderItems } from "./collections/OrderItems";
import { Orders } from "./collections/Orders";
import { ServiceSlots } from "./collections/ServiceSlots";
import { Sellers } from "./collections/Sellers";
import { Subscriptions } from "./collections/Subscriptions";

/**
 * kith-inn's Payload collections, consumed by the shared `apps/cms` host
 * (`payload.config.ts` does `collections: [...kithInnCollections]`). This package
 * owns the collection shapes + the tenant-isolation access/hooks; it depends on
 * Payload + the zero-dep `@cfp/kith-inn-shared` domain kernel (enums/types).
 *
 * Order matters only for relationship resolution (Payload handles cycles); the
 * list mirrors the spine grouping in PRD §7.
 */
export const collections: CollectionConfig[] = [
  // 平台
  Sellers,
  Operators,
  // 顾客
  Customers,
  CustomerAddresses,
  // 菜单枢纽
  Offerings,
  MenuPlans,
  // 订单 / 履约
  ServiceSlots,
  Orders,
  OrderItems,
  Fulfillments,
  // 对话留存
  ChatMessages,
  // 订阅 (V1 placeholder)
  Subscriptions,
];
