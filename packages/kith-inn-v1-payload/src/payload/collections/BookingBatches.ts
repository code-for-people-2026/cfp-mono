import type { CollectionConfig } from "payload";
import { BOOKING_BATCH_STATUSES } from "@cfp/kith-inn-v1-shared";
import { cmsAccess, sameSellerHooks, sellerField, trimText } from "./shared";

export const BookingBatches: CollectionConfig = {
  slug: "kiv1_booking_batches",
  admin: { useAsTitle: "title", group: "街坊味 v1 / 预订" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    {
      name: "publicId",
      type: "text",
      required: true,
      unique: true,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "title",
      type: "text",
      required: true,
      minLength: 1,
      maxLength: 120,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "open",
      options: [...BOOKING_BATCH_STATUSES]
    },
    {
      name: "mealSlots",
      type: "relationship",
      relationTo: "kiv1_meal_slots",
      hasMany: true,
      required: true,
      minRows: 1
    },
    {
      name: "createdBy",
      type: "relationship",
      relationTo: "kiv1_operators",
      required: true
    }
  ],
  indexes: [{ fields: ["seller", "status"] }]
};
