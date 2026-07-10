import type { CollectionConfig } from "payload";
import { OFFERING_CATEGORIES } from "@cfp/kith-inn-v1-shared";
import { cmsAccess, sameSellerHooks, sellerField, trimText } from "./shared";

export const Offerings: CollectionConfig = {
  slug: "kiv1_offerings",
  admin: { useAsTitle: "name", group: "街坊味 v1 / 菜单" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    {
      name: "name",
      type: "text",
      required: true,
      minLength: 1,
      maxLength: 80,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "mainIngredient",
      type: "text",
      maxLength: 80,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "category",
      type: "select",
      required: true,
      options: [...OFFERING_CATEGORIES]
    },
    { name: "active", type: "checkbox", required: true, defaultValue: true }
  ],
  indexes: [
    { fields: ["seller", "name"], unique: true },
    { fields: ["seller", "active", "category"] }
  ]
};
