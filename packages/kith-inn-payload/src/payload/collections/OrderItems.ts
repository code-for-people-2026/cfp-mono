import type { CollectionConfig } from "payload";
import { OCCASIONS } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `order_items` — order line at meal granularity (PRD §7.1). Cross-lunch/dinner
 * = same order multiple items (桃子常 2: 午+晚). `mealOccasion` is required before
 * confirm for occasion-granularity sellers; slot归属 = (order.date, mealOccasion)
 * logical hit, no FK. `unitPriceCents` snapshot at confirm (§3.3, M1).
 */
export const OrderItems: CollectionConfig = {
  slug: "order_items",
  admin: { useAsTitle: "quantity", group: "订单" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "order", type: "relationship", relationTo: "orders", required: true, index: true },
    { name: "offering", type: "relationship", relationTo: "offerings", required: true },
    { name: "mealOccasion", type: "select", options: [...OCCASIONS] },
    // M0: free-form time window text for time-slot sellers; structure it when
    // a real time-slot merchant needs it.
    { name: "timeWindow", type: "text" },
    { name: "quantity", type: "number", required: true },
    { name: "unitPriceCents", type: "number" },
    { name: "note", type: "textarea" },
    sellerField,
  ],
};
