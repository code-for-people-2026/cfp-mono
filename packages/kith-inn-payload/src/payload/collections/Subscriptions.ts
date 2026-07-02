import type { CollectionConfig } from "payload";
import { SUBSCRIPTION_STATUSES } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `subscriptions` — booking module (V1, PRD §7.2). `pattern` (json, required) is
 * the source of truth: which date + slot coords this
 * subscription generates orders on (specific-dates / recurring / open-ended). A
 * scheduled job materializes orders per-tenant with a seller token (§3.3⑤, V1).
 * Schema placeholder only in M0 — no behavior.
 */
export const Subscriptions: CollectionConfig = {
  slug: "subscriptions",
  admin: { useAsTitle: "customer", group: "订阅 (V1)" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "customer", type: "relationship", relationTo: "customers", required: true },
    { name: "offering", type: "relationship", relationTo: "offerings", required: true },
    { name: "pattern", type: "json", required: true },
    {
      name: "status",
      type: "select",
      options: [...SUBSCRIPTION_STATUSES],
      defaultValue: "active",
      index: true,
    },
    { name: "pausedRanges", type: "json" },
    sellerField,
  ],
};
