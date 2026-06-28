import type { CollectionConfig } from "payload";
import {
  FULFILLMENT_MODES,
  FULFILLMENT_STATUSES,
  OCCASIONS,
} from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `fulfillments` — thin fulfillment table (PRD §7.1). Built only for
 * delivery/pickup items at confirm time (M1); self/onsite get no row (so they
 * don't pollute gap reconciliation). `addrBuilding/addrUnit` are frozen
 * snapshots; `serviceDate/occasion` sync with the order in real time (§3.3).
 * `assignee` ∈ seller.moduleSettings.delivery.deliverers (hook-validated in M1).
 * No `sequence` (MVP — route optimization is explicitly out of scope, §1.3).
 */
export const Fulfillments: CollectionConfig = {
  slug: "fulfillments",
  admin: { useAsTitle: "serviceDate", group: "送餐" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    {
      name: "orderItem",
      type: "relationship",
      relationTo: "order_items",
      required: true,
    },
    { name: "serviceDate", type: "date", required: true, index: true },
    { name: "occasion", type: "select", options: [...OCCASIONS] },
    { name: "mode", type: "select", options: [...FULFILLMENT_MODES], required: true },
    {
      name: "status",
      type: "select",
      options: [...FULFILLMENT_STATUSES],
      defaultValue: "pending",
      index: true,
    },
    { name: "addrBuilding", type: "text", index: true },
    { name: "addrUnit", type: "text" },
    { name: "assignee", type: "text" },
    { name: "timeWindow", type: "text" },
    sellerField,
  ],
};
