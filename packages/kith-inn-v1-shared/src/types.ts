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
  generateMenusInputSchema,
  generateMenusResponseSchema,
  mealSlotCreateSchema,
  mealSlotSchema,
  mealSlotTargetSchema,
  mealSlotUpdateSchema,
  menuItemSnapshotSchema,
  offeringCreateSchema,
  offeringSchema,
  offeringUpdateSchema,
  relaxedRuleSchema,
  swapMenuItemResponseSchema
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
export type MenuItemSnapshot = z.infer<typeof menuItemSnapshotSchema>;
export type MealSlotTarget = z.infer<typeof mealSlotTargetSchema>;
export type MealSlot = z.infer<typeof mealSlotSchema>;
export type MealSlotCreate = z.infer<typeof mealSlotCreateSchema>;
export type MealSlotUpdate = z.infer<typeof mealSlotUpdateSchema>;
export type GenerateMenusInput = z.infer<typeof generateMenusInputSchema>;
export type GenerateMenusResponse = z.infer<typeof generateMenusResponseSchema>;
export type SwapMenuItemResponse = z.infer<typeof swapMenuItemResponseSchema>;
export type RelaxedRule = z.infer<typeof relaxedRuleSchema>;
