import { z } from "zod";
import {
  BOOKING_BATCH_STATUSES,
  DELIVERY_STATUSES,
  MEAL_SLOT_ORDER_STATUSES,
  OCCASIONS,
  OFFERING_CATEGORIES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SELLER_STATUSES
} from "./enums";

export const sellerStatusSchema = z.enum(SELLER_STATUSES);
export const occasionSchema = z.enum(OCCASIONS);
export const offeringCategorySchema = z.enum(OFFERING_CATEGORIES);
export const mealSlotOrderStatusSchema = z.enum(MEAL_SLOT_ORDER_STATUSES);
export const bookingBatchStatusSchema = z.enum(BOOKING_BATCH_STATUSES);
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const orderSourceSchema = z.enum(ORDER_SOURCES);
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);

export const relationshipIdSchema = z.union([z.string().min(1), z.number().int()]);

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}, "日期必须是有效的 YYYY-MM-DD");

export const nonNegativeIntegerSchema = z.number().int().nonnegative();
export const positiveIntegerSchema = z.number().int().positive();
export const zonedDateTimeSchema = z.iso.datetime({ offset: true });

const shortText = z.string().trim().min(1).max(80);
const optionalShortText = z.string().trim().max(80).nullish();
const optionalDateTime = zonedDateTimeSchema.nullish();

export const sellerInputSchema = z.object({
  name: shortText,
  defaultPriceCents: nonNegativeIntegerSchema.default(3000),
  status: sellerStatusSchema.default("active")
});

export const operatorInputSchema = z.object({
  seller: relationshipIdSchema,
  wechatOpenid: z.string().trim().min(1),
  active: z.boolean().default(true)
});

export const customerProfileInputSchema = z.object({
  seller: relationshipIdSchema,
  openid: z.string().trim().min(1).nullish(),
  displayName: shortText,
  address: z.string().trim().min(1).max(240),
  lastUsedAt: optionalDateTime,
  active: z.boolean().default(true)
});

export const offeringInputSchema = z.object({
  seller: relationshipIdSchema,
  name: shortText,
  mainIngredient: optionalShortText,
  category: offeringCategorySchema,
  active: z.boolean().default(true)
});

export const menuItemSchema = z.object({
  offering: relationshipIdSchema,
  nameSnapshot: shortText,
  mainIngredientSnapshot: optionalShortText,
  categorySnapshot: offeringCategorySchema
});

export const mealSlotInputSchema = z.object({
  seller: relationshipIdSchema,
  date: calendarDateSchema,
  occasion: occasionSchema,
  menuItems: z.array(menuItemSchema).nullish(),
  orderStatus: mealSlotOrderStatusSchema.default("draft"),
  orderDeadline: optionalDateTime,
  priceCents: nonNegativeIntegerSchema.nullish(),
  generatedAt: optionalDateTime
});

export const bookingBatchInputSchema = z.object({
  seller: relationshipIdSchema,
  publicId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120),
  status: bookingBatchStatusSchema.default("open"),
  mealSlots: z.array(relationshipIdSchema).min(1),
  createdBy: relationshipIdSchema
});

export const orderInputSchema = z.object({
  seller: relationshipIdSchema,
  mealSlot: relationshipIdSchema,
  customerProfile: relationshipIdSchema.nullish(),
  customerOpenid: z.string().trim().min(1).nullish(),
  status: orderStatusSchema.default("draft"),
  source: orderSourceSchema,
  displayName: shortText,
  address: z.string().trim().max(240).nullish(),
  quantity: positiveIntegerSchema,
  unitPriceCents: nonNegativeIntegerSchema,
  paymentStatus: paymentStatusSchema.default("unpaid"),
  paidAt: optionalDateTime,
  deliveryStatus: deliveryStatusSchema.default("pending"),
  deliveredAt: optionalDateTime,
  confirmedAt: optionalDateTime,
  canceledAt: optionalDateTime,
  note: z.string().max(1000).nullish()
});
