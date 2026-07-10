import type { CollectionConfig } from "payload";
import {
  DELIVERY_STATUSES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_STATUSES
} from "@cfp/kith-inn-v1-shared";
import {
  cmsAccess,
  sameSellerHooks,
  sellerField,
  trimText,
  validateNonNegativeInteger,
  validatePositiveInteger
} from "./shared";

export const Orders: CollectionConfig = {
  slug: "kiv1_orders",
  admin: { useAsTitle: "displayName", group: "街坊味 v1 / 订单" },
  access: cmsAccess,
  hooks: sameSellerHooks,
  fields: [
    sellerField(),
    {
      name: "mealSlot",
      type: "relationship",
      relationTo: "kiv1_meal_slots",
      required: true
    },
    {
      name: "customerProfile",
      type: "relationship",
      relationTo: "kiv1_customer_profiles",
      required: false
    },
    {
      name: "customerOpenid",
      type: "text",
      index: true,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "status",
      type: "select",
      required: true,
      defaultValue: "draft",
      options: [...ORDER_STATUSES]
    },
    { name: "source", type: "select", required: true, options: [...ORDER_SOURCES] },
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
      maxLength: 240,
      hooks: { beforeValidate: [trimText] }
    },
    {
      name: "quantity",
      type: "number",
      required: true,
      min: 1,
      admin: { step: 1 },
      validate: validatePositiveInteger
    },
    {
      name: "unitPriceCents",
      type: "number",
      required: true,
      min: 0,
      admin: { step: 1 },
      validate: validateNonNegativeInteger
    },
    {
      name: "paymentStatus",
      type: "select",
      required: true,
      defaultValue: "unpaid",
      options: [...PAYMENT_STATUSES]
    },
    { name: "paidAt", type: "date" },
    {
      name: "deliveryStatus",
      type: "select",
      required: true,
      defaultValue: "pending",
      options: [...DELIVERY_STATUSES]
    },
    { name: "deliveredAt", type: "date" },
    { name: "confirmedAt", type: "date" },
    { name: "canceledAt", type: "date" },
    { name: "note", type: "textarea", maxLength: 1000 }
  ],
  indexes: [
    { fields: ["seller", "mealSlot", "customerProfile"], unique: true },
    { fields: ["seller", "mealSlot", "status"] },
    { fields: ["seller", "customerOpenid"] }
  ]
};
