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
import type {
  importCommitInputSchema,
  importCommitResponseSchema,
  importPreviewResponseSchema,
  offeringCreateSchema,
  offeringSchema,
  offeringUpdateSchema
} from "./api";

export type SellerInput = z.infer<typeof sellerInputSchema>;
export type OperatorInput = z.infer<typeof operatorInputSchema>;
export type CustomerProfileInput = z.infer<typeof customerProfileInputSchema>;
export type OfferingInput = z.infer<typeof offeringInputSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type MealSlotInput = z.infer<typeof mealSlotInputSchema>;
export type BookingBatchInput = z.infer<typeof bookingBatchInputSchema>;
export type OrderInput = z.infer<typeof orderInputSchema>;
export type Offering = z.infer<typeof offeringSchema>;
export type OfferingCreate = z.infer<typeof offeringCreateSchema>;
export type OfferingUpdate = z.infer<typeof offeringUpdateSchema>;
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;
export type ImportCommitInput = z.infer<typeof importCommitInputSchema>;
export type ImportCommitResponse = z.infer<typeof importCommitResponseSchema>;
