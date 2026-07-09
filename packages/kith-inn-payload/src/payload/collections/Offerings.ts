import type { CollectionConfig } from "payload";
import { OFFERING_CATEGORIES, OFFERING_KINDS } from "@cfp/kith-inn-shared";
import { sellerField, tenantAccess, tenantHooks } from "./shared";

/**
 * `offerings` — the shared hub of menu ↔ order ↔ purchasing (PRD §7.1). A dish
 * is `kind: "component"`; a combo (`combo-meal`) relates to its components via
 * `parentOfferings` (self-relationship). `mainIngredient` is the real
 * de-duplication axis ("肉就那几样"). `recipe` (json) feeds purchasing
 * aggregation (M2).
 */
export const Offerings: CollectionConfig = {
  slug: "offerings",
  admin: { useAsTitle: "name", group: "菜单" },
  access: tenantAccess,
  hooks: tenantHooks,
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
      // combo → its components (self-relationship). A hook in M1 validates that a
      // combo only points at components (and components carry no parent).
      name: "parentOfferings",
      type: "relationship",
      relationTo: "offerings",
      hasMany: true,
    },
    { name: "unitLabel", type: "text" },
    { name: "priceCents", type: "number" },
    {
      name: "recipe",
      type: "json",
      // shape: { ingredients: [{ name, qtyPerServing, unit }], yieldServings? }
      // only component/single-item; combo derives from its components.
    },
    { name: "active", type: "checkbox", defaultValue: true },
    sellerField,
  ],
};
