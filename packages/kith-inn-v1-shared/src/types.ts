import type { z } from "zod";
import type {
  bookingBatchInputSchema,
  customerProfileInputSchema,
  mealSlotInputSchema,
  menuItemSchema,
  offeringInputSchema,
  operatorInputSchema,
  orderInputSchema,
  sellerInputSchema
} from "./schemas";

export type SellerInput = z.infer<typeof sellerInputSchema>;
export type OperatorInput = z.infer<typeof operatorInputSchema>;
export type CustomerProfileInput = z.infer<typeof customerProfileInputSchema>;
export type OfferingInput = z.infer<typeof offeringInputSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MealSlotInput = z.infer<typeof mealSlotInputSchema>;
export type BookingBatchInput = z.infer<typeof bookingBatchInputSchema>;
export type OrderInput = z.infer<typeof orderInputSchema>;
