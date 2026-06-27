import type { CollectionBeforeChangeHook, CollectionConfig } from "payload";
import { OFFERING_CATEGORIES, OFFERING_KINDS } from "@cfp/kith-inn-shared";
import { tenantScoped } from "../access/tenantScoped";
import { assertSameTenantRefs } from "../hooks/assertSameTenantRefs";
import { stampSeller } from "../hooks/stampSeller";

/**
 * `offerings` — the shared hub of menu ↔ order ↔ purchasing (PRD §7.1). A dish is
 * `kind: "component"`; `mainIngredient` is the real de-duplication axis ("肉就那
 * 几样"). The spike's tenant-scoped test subject: it carries `seller` and goes
 * through `tenantScoped()` + `stampSeller`. Fields expand to the full model in
 * PR3; M0 carries only what the H5 offering-pool deliverable needs.
 */
export const Offerings: CollectionConfig = {
  slug: "offerings",
  admin: { useAsTitle: "name", group: "菜单" },
  access: tenantScoped(),
  hooks: {
    // stampSeller nails the row's own seller; assertSameTenantRefs nails every
    // relationship the row points at (defense in depth, Tech Spec §3.1).
    beforeChange: [
      stampSeller as CollectionBeforeChangeHook,
      assertSameTenantRefs as CollectionBeforeChangeHook,
    ],
  },
  fields: [
    { name: "name", type: "text", required: true },
    {
      name: "kind",
      type: "select",
      options: [...OFFERING_KINDS],
      defaultValue: "component",
      required: true,
    },
    { name: "mainIngredient", type: "text", index: true },
    {
      name: "category",
      type: "select",
      // kebab values + 中文 labels (PRD §7 naming convention), sourced from the
      // shared domain kernel so FE/BE/cms agree on the menu 荤素 structure.
      options: OFFERING_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
    },
    {
      name: "seller",
      type: "relationship",
      relationTo: "sellers",
      required: true,
      index: true,
    },
  ],
};
