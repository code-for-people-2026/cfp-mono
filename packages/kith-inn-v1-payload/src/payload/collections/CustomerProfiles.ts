import type { CollectionConfig } from "payload";
import { cmsAccess, sameSellerHooks, sellerField, trimText } from "./shared";

export const CustomerProfiles: CollectionConfig = {
  slug: "kiv1_customer_profiles",
  admin: { useAsTitle: "displayName", group: "街坊味 v1 / 顾客" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    { name: "openid", type: "text", index: true, hooks: { beforeValidate: [trimText] } },
    {
      name: "displayName",
      type: "text",
      required: true,
      minLength: 1,
      maxLength: 80,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "address",
      type: "text",
      required: true,
      minLength: 1,
      maxLength: 240,
      hooks: { beforeValidate: [trimText] }
    },
    { name: "lastUsedAt", type: "date" },
    { name: "active", type: "checkbox", required: true, defaultValue: true }
  ],
  indexes: [{ fields: ["seller", "openid", "active"] }]
};
