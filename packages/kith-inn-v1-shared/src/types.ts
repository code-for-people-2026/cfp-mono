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
  cmsCustomerProfileSchema,
  cmsOrderCreateSchema,
  cmsOrderUpdateSchema,
  customerProfileCreateSchema,
  customerProfileSchema,
  mealSlotCreateSchema,
  mealSlotSchema,
  mealSlotTargetSchema,
  mealSlotUpdateSchema,
  menuItemSnapshotSchema,
  offeringCreateSchema,
  offeringSchema,
  offeringUpdateSchema,
  manualOrderCreateSchema,
  manualOrderUpdateSchema,
  orderActionSchema,
  orderListResponseSchema,
  orderResubmitSchema,
  orderSchema,
  orderSummarySchema,
  relaxedRuleSchema,
  sellerSnapshotSchema,
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
export type SellerSnapshot = z.infer<typeof sellerSnapshotSchema>;
export type CustomerProfile = z.infer<typeof customerProfileSchema>;
export type CmsCustomerProfile = z.infer<typeof cmsCustomerProfileSchema>;
export type CustomerProfileCreate = z.infer<typeof customerProfileCreateSchema>;
export type Order = z.infer<typeof orderSchema>;
export type ManualOrderCreate = z.infer<typeof manualOrderCreateSchema>;
export type ManualOrderUpdate = z.infer<typeof manualOrderUpdateSchema>;
export type CmsOrderCreate = z.infer<typeof cmsOrderCreateSchema>;
export type CmsOrderUpdate = z.infer<typeof cmsOrderUpdateSchema>;
export type OrderAction = z.infer<typeof orderActionSchema>;
export type OrderResubmit = z.infer<typeof orderResubmitSchema>;
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;
