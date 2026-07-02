import type { CollectionConfig } from "payload";
import { OCCASIONS } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `customers` — lightweight customer card (PRD §7.1). displayName is the
 * identification key (接龙里的称呼, not unique — MVP matches by name + manual
 * merge). Mostly auto-sedimented at order-parse time (M1).
 */
export const Customers: CollectionConfig = {
  slug: "customers",
  admin: { useAsTitle: "displayName", group: "顾客" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "displayName", type: "text", required: true, index: true },
    { name: "defaultServings", type: "number" },
    { name: "defaultOccasion", type: "select", options: [...OCCASIONS] },
    { name: "note", type: "textarea" },
    { name: "address", type: "text", index: true },
    sellerField,
  ],
};
