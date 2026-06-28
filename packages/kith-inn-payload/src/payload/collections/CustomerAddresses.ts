import type { CollectionConfig } from "payload";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `customer_addresses` — 1:N learned addresses (PRD §7.1). `building` is the
 * delivery-grouping key (送餐按楼栋成批). 接龙里没地址；首次私信拿到录一次、
 * 之后自动带出 (§6.4). `lastUsedAt` sorts the "default/recent" address.
 */
export const CustomerAddresses: CollectionConfig = {
  slug: "customer_addresses",
  admin: { useAsTitle: "building", group: "顾客" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    {
      name: "customer",
      type: "relationship",
      relationTo: "customers",
      required: true,
      index: true,
    },
    { name: "building", type: "text", required: true, index: true },
    { name: "unit", type: "text" },
    { name: "lastUsedAt", type: "date" },
    sellerField,
  ],
};
