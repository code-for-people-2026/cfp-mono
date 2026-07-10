import type { CollectionConfig } from "payload";
import { SELLER_STATUSES } from "@cfp/kith-inn-v1-shared";
import { cmsAccess, trimText, validateNonNegativeInteger } from "./shared";

export const Sellers: CollectionConfig = {
  slug: "kiv1_sellers",
  admin: { useAsTitle: "name", group: "街坊味 v1 / 平台" },
  access: { ...cmsAccess, delete: () => false },
  fields: [
    {
      name: "name",
      type: "text",
      required: true,
      minLength: 1,
      maxLength: 80,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "defaultPriceCents",
      type: "number",
      required: true,
      defaultValue: 3000,
      min: 0,
      admin: { step: 1 },
      validate: validateNonNegativeInteger
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "active",
      options: [...SELLER_STATUSES],
      index: true
    }
  ]
};
