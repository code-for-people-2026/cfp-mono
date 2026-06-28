import type { CollectionConfig } from "payload";
import { MENU_PLAN_STATUSES } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `menu_plans` — the menu bound to a slot (PRD §7.2). The ONLY module table in
 * MVP. Doesn't hold dishes — its offerings relate to `offerings` (whose
 * `parentOfferings` carry a combo's components). `published` ≠ posted to the
 * WeChat group (that's an offline action the app can't observe).
 */
export const MenuPlans: CollectionConfig = {
  slug: "menu_plans",
  admin: { useAsTitle: "slot", group: "菜单" },
  access: tenantAccess,
  hooks: tenantHooks,
  fields: [
    { name: "slot", type: "relationship", relationTo: "service_slots", required: true },
    {
      name: "offerings",
      type: "relationship",
      relationTo: "offerings",
      hasMany: true,
    },
    { name: "publishText", type: "textarea" },
    {
      name: "status",
      type: "select",
      options: [...MENU_PLAN_STATUSES],
      defaultValue: "draft",
    },
    sellerField,
  ],
};
