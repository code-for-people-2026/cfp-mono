import type { CollectionConfig } from "payload";
import { SELLER_MODULES, SELLER_STATUSES } from "@cfp/kith-inn-shared";

const authenticated = ({ req }: { req: { user?: unknown } }) => Boolean(req.user);

/**
 * `sellers` — the tenant root (PRD §7.1). One seller = one "灶台". M0 seeds 桃子
 * directly (PR3); multi-seller self-onboarding is M4. It is NOT itself
 * tenant-scoped (it IS the tenant), so it does not go through `tenantScoped()`.
 *
 * The operator profile = `enabledModules` (which modules are on — drives access
 * gating, tab visibility, agent-tool registration) + `moduleSettings` (per-module
 * config json: 桃子 = 4菜1汤 / 周一至五 / 午晚 / deliverers=["奶奶"]) +
 * `defaultPriceCents` (pricing-resolver fallback, 桃子=3000).
 */
export const Sellers: CollectionConfig = {
  slug: "sellers",
  admin: { useAsTitle: "name", group: "平台" },
  access: {
    read: authenticated,
    create: authenticated,
    update: authenticated,
    delete: () => false,
  },
  fields: [
    { name: "name", label: "商家名", type: "text", required: true },
    { name: "serviceArea", type: "textarea" },
    { name: "defaultPriceCents", type: "number" },
    {
      name: "status",
      type: "select",
      options: [...SELLER_STATUSES],
      defaultValue: "active",
    },
    {
      name: "enabledModules",
      type: "select",
      options: [...SELLER_MODULES],
      hasMany: true,
    },
    // Per-module config (e.g. { delivery: { deliverers: ["奶奶"] }, menuStructure:
    // "4菜1汤", serviceDays: [...], occasions: [...] }). "Data not schema" —
    // adapts to heterogeneous producers without rigid fields.
    { name: "moduleSettings", type: "json" },
    { name: "profileFreeText", type: "textarea" },
  ],
};
