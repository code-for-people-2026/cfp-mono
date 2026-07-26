import type { CollectionConfig } from "payload";
import { BOOKING_BATCH_STATUSES, OCCASIONS } from "@cfp/kith-inn-v1-shared";
import { bookingShareTargetSchema } from "@cfp/kith-inn-v1-shared/api";
import {
  cmsAccess,
  sameSellerHooks,
  sellerField,
  trimText,
  validateCalendarDate
} from "./shared";

const validateTarget = (value: unknown): true | string => {
  if (value == null) return true;
  if (typeof value === "object" && Object.values(value).every((item) => item == null)) return true;
  return bookingShareTargetSchema.safeParse(value).success || "分享目标必须是完整的日期或餐次定位";
};

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
    },
    {
      name: "target",
      type: "group",
      required: false,
      validate: validateTarget,
      fields: [
        { name: "kind", type: "select", options: ["day", "meal"] },
        { name: "date", type: "text", validate: validateCalendarDate },
        { name: "occasion", type: "select", options: [...OCCASIONS] }
      ]
    }
  ],
  indexes: [{ fields: ["seller", "status"] }]
};
