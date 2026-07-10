import type { CollectionConfig } from "payload";
import {
  MEAL_SLOT_ORDER_STATUSES,
  OCCASIONS,
  OFFERING_CATEGORIES
} from "@cfp/kith-inn-v1-shared";
import {
  cmsAccess,
  sameSellerHooks,
  sellerField,
  trimText,
  validateCalendarDate,
  validateNonNegativeInteger
} from "./shared";

export const MealSlots: CollectionConfig = {
  slug: "kiv1_meal_slots",
  admin: { useAsTitle: "date", group: "街坊味 v1 / 菜单" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    {
      name: "date",
      type: "text",
      required: true,
      validate: validateCalendarDate
    },
    { name: "occasion", type: "select", required: true, options: [...OCCASIONS] },
    {
      name: "menuItems",
      type: "array",
      fields: [
        {
          name: "offering",
          type: "relationship",
          relationTo: "kiv1_offerings",
          required: true
        },
        {
          name: "nameSnapshot",
          type: "text",
          required: true,
          maxLength: 80,
          hooks: { beforeValidate: [trimText] }
        },
        {
          name: "mainIngredientSnapshot",
          type: "text",
          maxLength: 80,
          hooks: { beforeValidate: [trimText] }
        },
        {
          name: "categorySnapshot",
          type: "select",
          required: true,
          options: [...OFFERING_CATEGORIES]
        }
      ]
    },
    {
      name: "orderStatus",
      type: "select",
      required: true,
      defaultValue: "draft",
      options: [...MEAL_SLOT_ORDER_STATUSES]
    },
    { name: "orderDeadline", type: "date" },
    {
      name: "priceCents",
      type: "number",
      min: 0,
      admin: { step: 1 },
      validate: validateNonNegativeInteger
    },
    { name: "generatedAt", type: "date" }
  ],
  indexes: [
    { fields: ["seller", "date", "occasion"], unique: true },
    { fields: ["seller", "orderStatus"] }
  ]
};
