import type { CollectionConfig } from "payload";
import { OCCASIONS } from "@cfp/kith-inn-v1-shared";
import {
  cmsAccess,
  sameSellerHooks,
  sellerField,
  trimText,
  validateCalendarDate
} from "./shared";

export const ServiceClosures: CollectionConfig = {
  slug: "kiv1_service_closures",
  admin: { useAsTitle: "date", group: "街坊味 v1 / 预订" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    { name: "date", type: "text", required: true, validate: validateCalendarDate },
    { name: "occasion", type: "select", required: false, options: [...OCCASIONS] },
    {
      name: "note",
      type: "text",
      maxLength: 80,
      hooks: { beforeValidate: [trimText] }
    }
  ],
  // NULL-aware uniqueness is supplied by the CMS partial indexes.
  indexes: [{ fields: ["seller", "date", "occasion"] }]
};
