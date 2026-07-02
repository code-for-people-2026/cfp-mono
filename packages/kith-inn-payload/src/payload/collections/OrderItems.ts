import type { CollectionConfig } from "payload";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `order_items` — order line (one offering × quantity). Meal occasion belongs
 * to the parent order, so lunch/dinner are separate orders even if parsed from
 * the same jielong message. `unitPriceCents` snapshot at confirm (§3.3, M1).
 */
export const OrderItems: CollectionConfig = {
  slug: "order_items",
  admin: { useAsTitle: "quantity", group: "订单" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "order", type: "relationship", relationTo: "orders", required: true, index: true },
    { name: "offering", type: "relationship", relationTo: "offerings", required: true },
    { name: "quantity", type: "number", required: true },
    { name: "unitPriceCents", type: "number" },
    { name: "note", type: "textarea" },
    sellerField,
  ],
};
