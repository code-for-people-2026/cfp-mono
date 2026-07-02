import type { CollectionConfig } from "payload";
import { FULFILLMENT_STATUSES, OCCASIONS } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `fulfillments` — thin delivery task table (PRD §7.1). One fulfillment per
 * confirmed order; address is read from order.address. No helper assignment or
 * handoff state in MVP.
 */
export const Fulfillments: CollectionConfig = {
  slug: "fulfillments",
  admin: { useAsTitle: "serviceDate", group: "送餐" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    {
      name: "order",
      type: "relationship",
      relationTo: "orders",
      required: true,
      index: true,
    },
    { name: "serviceDate", type: "date", required: true, index: true },
    { name: "occasion", type: "select", options: [...OCCASIONS] },
    {
      name: "status",
      type: "select",
      options: [...FULFILLMENT_STATUSES],
      defaultValue: "pending",
      index: true,
    },
    sellerField,
  ],
};
