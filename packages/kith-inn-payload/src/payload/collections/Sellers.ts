import type { CollectionConfig } from "payload";

const authenticated = ({ req }: { req: { user?: unknown } }) => Boolean(req.user);

/**
 * `sellers` — the tenant root (PRD §7.1). One seller = one "灶台". M0 seeds 桃子
 * directly (PR3); multi-seller self-onboarding is M4. It is NOT itself
 * tenant-scoped (it IS the tenant), so it does not go through `tenantScoped()`.
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
  fields: [{ name: "name", label: "商家名", type: "text", required: true }],
};
