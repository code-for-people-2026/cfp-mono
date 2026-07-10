import type { CollectionConfig } from "payload";
import { cmsAccess, sameSellerHooks, sellerField, trimText } from "./shared";

export const Operators: CollectionConfig = {
  slug: "kiv1_operators",
  admin: { group: "街坊味 v1 / 平台" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    {
      name: "wechatOpenid",
      type: "text",
      required: true,
      hooks: { beforeValidate: [trimText] },
      admin: { hidden: true }
    },
    { name: "active", type: "checkbox", required: true, defaultValue: true }
  ],
  indexes: [{ fields: ["seller", "wechatOpenid"], unique: true }]
};
