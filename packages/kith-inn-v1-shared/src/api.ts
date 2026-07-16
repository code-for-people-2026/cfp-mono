import { z } from "zod";
import {
  bookingBatchStatusSchema,
  calendarDateSchema,
  deliveryStatusSchema,
  mealSlotOrderStatusSchema,
  nonNegativeIntegerSchema,
  occasionSchema,
  offeringCategorySchema,
  orderSourceSchema,
  orderStatusSchema,
  paymentStatusSchema,
  positiveIntegerSchema,
  relationshipIdSchema,
  sellerStatusSchema,
  zonedDateTimeSchema
} from "./schemas";

export const operatorSessionSchema = z.object({
  operatorId: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  sellerName: z.string().trim().min(1).max(80),
  role: z.literal("operator"),
  expiresAt: zonedDateTimeSchema
}).strict();

export const authenticatedResponseSchema = z.object({
  status: z.literal("authenticated"),
  token: z.string().min(1),
  session: operatorSessionSchema
}).strict();

export const sellerSelectionResponseSchema = z.object({
  status: z.literal("seller-selection-required"),
  selectionToken: z.string().min(1),
  sellers: z.array(z.object({
    sellerId: relationshipIdSchema,
    sellerName: z.string().trim().min(1).max(80)
  }).strict()).min(2)
}).strict();

export const authResponseSchema = z.discriminatedUnion("status", [
  authenticatedResponseSchema,
  sellerSelectionResponseSchema
]);

export const wxLoginInputSchema = z.object({ code: z.string().min(1) }).strict();
export const devLoginInputSchema = z.object({ openid: z.string().min(1) }).strict();
export const selectSellerInputSchema = z.object({
  selectionToken: z.string().min(1),
  sellerId: relationshipIdSchema
}).strict();

export const apiErrorSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1)
}).passthrough();

const shortText = z.string().trim().min(1).max(80);
const mainIngredient = z.string().trim().max(80).nullable();

export const offeringSchema = z.object({
  id: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  name: shortText,
  mainIngredient,
  category: offeringCategorySchema,
  active: z.boolean()
}).strict();

export const offeringCreateSchema = z.object({
  name: shortText,
  mainIngredient: mainIngredient.optional(),
  category: offeringCategorySchema
}).strict();

export const offeringUpdateSchema = z.object({
  name: shortText.optional(),
  mainIngredient: mainIngredient.optional(),
  category: offeringCategorySchema.optional(),
  active: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "至少更新一个字段" });

const line = z.number().int().positive();
const raw = z.string();
const parsedOfferingSchema = offeringCreateSchema;

export const importPreviewRowSchema = z.discriminatedUnion("status", [
  z.object({
    line,
    raw,
    parsed: parsedOfferingSchema,
    status: z.literal("ready"),
    defaultAction: z.literal("create")
  }).strict(),
  z.object({
    line,
    raw,
    parsed: parsedOfferingSchema,
    status: z.literal("conflict"),
    existingId: relationshipIdSchema,
    defaultAction: z.literal("skip")
  }).strict(),
  z.object({
    line,
    raw,
    status: z.literal("invalid"),
    error: z.string().min(1)
  }).strict()
]);

const importTextSchema = z.string().min(1).max(20_000);
const previewSummarySchema = z.object({
  ready: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative()
}).strict();

export const importPreviewInputSchema = z.object({ text: importTextSchema }).strict();
export const importPreviewResponseSchema = z.object({
  rows: z.array(importPreviewRowSchema),
  summary: previewSummarySchema
}).strict();

export const importCommitInputSchema = z.object({
  text: importTextSchema,
  conflicts: z.array(z.object({
    line,
    action: z.literal("overwrite")
  }).strict()).max(50).default([])
}).strict().refine(
  ({ conflicts }) => new Set(conflicts.map((conflict) => conflict.line)).size === conflicts.length,
  { message: "同一行只能指定一次冲突操作" }
);

export const importCommitResultSchema = z.discriminatedUnion("status", [
  z.object({ line, status: z.literal("created"), id: relationshipIdSchema }).strict(),
  z.object({ line, status: z.literal("overwritten"), id: relationshipIdSchema }).strict(),
  z.object({ line, status: z.literal("skipped"), id: relationshipIdSchema }).strict(),
  z.object({ line, status: z.literal("failed"), error: z.string().min(1) }).strict()
]);

export const importCommitResponseSchema = z.object({
  results: z.array(importCommitResultSchema),
  summary: z.object({
    created: z.number().int().nonnegative(),
    overwritten: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative()
  }).strict()
}).strict();

export const relaxedRuleSchema = z.enum([
  "same-week-offering",
  "same-day-main-ingredient",
  "recent-offering",
  "recent-main-ingredient"
]);

export const menuItemSnapshotSchema = z.object({
  offeringId: relationshipIdSchema,
  nameSnapshot: shortText,
  mainIngredientSnapshot: mainIngredient,
  categorySnapshot: offeringCategorySchema
}).strict();

export const customerMenuItemSnapshotSchema = menuItemSnapshotSchema.omit({ offeringId: true }).strict();

export const mealSlotTargetSchema = z.object({
  date: calendarDateSchema,
  occasion: occasionSchema
}).strict();

const dateNumber = (value: string) => Date.parse(`${value}T00:00:00.000Z`);
const validRange = ({ from, to }: { from: string; to: string }) => {
  const days = (dateNumber(to) - dateNumber(from)) / 86_400_000;
  return days >= 0 && days <= 30;
};

export const mealSlotRangeSchema = z.object({
  from: calendarDateSchema,
  to: calendarDateSchema
}).strict().refine(validRange, { message: "日期范围最多 31 天" });

export const mealSlotSchema = z.object({
  id: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  date: calendarDateSchema,
  occasion: occasionSchema,
  menuItems: z.array(menuItemSnapshotSchema).length(5),
  orderStatus: mealSlotOrderStatusSchema,
  orderDeadline: zonedDateTimeSchema.nullable(),
  priceCents: nonNegativeIntegerSchema.nullable(),
  generatedAt: zonedDateTimeSchema.nullable()
}).strict();

export const mealSlotCreateSchema = z.object({
  date: calendarDateSchema,
  occasion: occasionSchema,
  menuItems: z.array(menuItemSnapshotSchema).length(5),
  generatedAt: zonedDateTimeSchema
}).strict();

export const mealSlotUpdateSchema = z.object({
  menuItems: z.array(menuItemSnapshotSchema).length(5),
  generatedAt: zonedDateTimeSchema
}).strict();

export const mealSlotBookingConfigSchema = z.object({
  priceCents: nonNegativeIntegerSchema.nullable().optional(),
  orderDeadline: zonedDateTimeSchema.nullable().optional(),
  orderStatus: mealSlotOrderStatusSchema.optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "至少更新一个预订配置字段" });

const uniqueMealSlotIds = z.array(relationshipIdSchema).min(1).transform((ids) => [
  ...new Map(ids.map((id) => [String(id), id])).values()
]).refine((ids) => ids.length <= 20, { message: "一个预订批次最多包含 20 个餐次" });

export const bookingBatchSchema = z.object({
  id: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  publicId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  status: bookingBatchStatusSchema,
  mealSlotIds: z.array(relationshipIdSchema).min(1).max(20),
  createdById: relationshipIdSchema
}).strict();

export const bookingBatchCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  mealSlotIds: uniqueMealSlotIds
}).strict();

export const cmsBookingBatchCreateSchema = z.object({
  publicId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  status: z.literal("open"),
  mealSlotIds: z.array(relationshipIdSchema).min(1).max(20),
  createdById: relationshipIdSchema
}).strict();

export const bookingBatchUpdateSchema = z.object({ status: z.literal("closed") }).strict();

export const bookingBatchListQuerySchema = z.object({
  status: bookingBatchStatusSchema.optional()
}).strict();

export const bookingBatchShareSchema = z.object({
  title: z.string().trim().min(1).max(120),
  path: z.string().startsWith("/pages/booking/index?batch=")
}).strict();

export const bookingBatchMutationResponseSchema = z.object({
  doc: bookingBatchSchema,
  share: bookingBatchShareSchema
}).strict();

export const bookingBatchListResponseSchema = z.object({
  docs: z.array(bookingBatchMutationResponseSchema)
}).strict();

const uniqueTargets = z.array(mealSlotTargetSchema).min(1).max(100).transform((targets) => [
  ...new Map(targets.map((target) => [`${target.date}:${target.occasion}`, target])).values()
]).refine((targets) => targets.length <= 20, { message: "一次最多生成 20 个餐次" });

export const generateMenusInputSchema = z.object({
  targets: uniqueTargets,
  replaceExisting: z.boolean().default(false)
}).strict();

export const generateMenusResponseSchema = z.object({
  docs: z.array(mealSlotSchema),
  relaxedRules: z.array(relaxedRuleSchema)
}).strict();

export const swapMenuItemInputSchema = z.object({
  offeringId: relationshipIdSchema
}).strict();

export const swapMenuItemResponseSchema = z.object({
  doc: mealSlotSchema,
  relaxedRules: z.array(relaxedRuleSchema)
}).strict();

export const mealSlotsExistErrorSchema = z.object({
  error: z.literal("meal-slots-exist"),
  message: z.string().min(1),
  existingTargets: z.array(mealSlotTargetSchema).min(1)
}).strict();

export const offeringPoolInsufficientErrorSchema = z.object({
  error: z.literal("offering-pool-insufficient"),
  message: z.string().min(1),
  shortages: z.array(z.object({
    category: offeringCategorySchema,
    required: z.number().int().positive(),
    available: z.number().int().nonnegative()
  }).strict()).min(1)
}).strict();

const addressSchema = z.string().trim().min(1).max(240);
const noteSchema = z.string().max(1000).nullable();

export const sellerSnapshotSchema = z.object({
  id: relationshipIdSchema,
  name: shortText,
  defaultPriceCents: nonNegativeIntegerSchema,
  status: sellerStatusSchema
}).strict();

export const customerSessionSchema = z.object({
  sellerName: shortText,
  role: z.literal("customer"),
  expiresAt: zonedDateTimeSchema
}).strict();

export const customerSessionResponseSchema = z.object({
  token: z.string().min(1),
  session: customerSessionSchema
}).strict();

export const customerWxSessionInputSchema = z.object({
  code: z.string().min(1),
  batchPublicId: z.string().uuid()
}).strict();

export const customerDevSessionInputSchema = z.object({
  openid: z.string().trim().min(1),
  batchPublicId: z.string().uuid()
}).strict();

export const customerSessionBootstrapInputSchema = z.object({
  batchPublicId: z.string().uuid()
}).strict();

export const customerSessionBootstrapResponseSchema = z.object({
  seller: sellerSnapshotSchema,
  batch: bookingBatchSchema
}).strict();

export const cmsCustomerBookingBatchSchema = customerSessionBootstrapResponseSchema.extend({
  slots: z.array(mealSlotSchema).min(1).max(20)
}).strict();

export const customerBookingUnavailableReasonSchema = z.enum([
  "booking-batch-closed",
  "meal-slot-closed",
  "order-deadline-passed"
]);

export const customerBookingSlotViewSchema = z.object({
  date: calendarDateSchema,
  occasion: occasionSchema,
  menuItems: z.array(customerMenuItemSnapshotSchema).length(5),
  unitPriceCents: nonNegativeIntegerSchema,
  orderDeadline: zonedDateTimeSchema.nullable(),
  canBook: z.boolean(),
  unavailableReason: customerBookingUnavailableReasonSchema.nullable()
}).strict().refine(
  ({ canBook, unavailableReason }) => canBook === (unavailableReason === null),
  { message: "可登记状态与原因不一致" }
);

export const customerBookingBatchViewSchema = z.object({
  sellerName: shortText,
  title: z.string().trim().min(1).max(120),
  status: bookingBatchStatusSchema,
  sharePath: z.string().startsWith("/pages/booking/index?batch="),
  slots: z.array(customerBookingSlotViewSchema).min(1).max(20)
}).strict();

export const customerProfileSchema = z.object({
  id: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  displayName: shortText,
  address: addressSchema,
  active: z.boolean()
}).strict();

export const cmsCustomerProfileSchema = customerProfileSchema.extend({
  openid: z.string().trim().min(1).nullable()
}).strict();

export const customerProfileCreateSchema = z.object({
  displayName: shortText,
  address: addressSchema
}).strict();

export const customerProfilesResponseSchema = z.object({
  docs: z.array(customerProfileSchema)
}).strict();

export const customerProfileResponseSchema = z.object({
  doc: customerProfileSchema
}).strict();

export const customerReservationProfileSchema = z.union([
  z.object({ customerProfileId: relationshipIdSchema }).strict(),
  z.object({ newProfile: customerProfileCreateSchema }).strict()
]);

export const customerReservationItemSchema = z.object({
  mealSlotId: relationshipIdSchema,
  quantity: positiveIntegerSchema,
  resubmitCanceled: z.boolean().default(false)
}).strict();

const customerReservationItemsInputSchema = z.array(customerReservationItemSchema).min(1).superRefine(
  (items, context) => {
    const firstByMealSlot = new Map<string, (typeof items)[number]>();
    items.forEach((item, index) => {
      const key = String(item.mealSlotId);
      const first = firstByMealSlot.get(key);
      if (first === undefined) {
        firstByMealSlot.set(key, item);
        return;
      }
      if (first.quantity !== item.quantity || first.resubmitCanceled !== item.resubmitCanceled) {
        context.addIssue({
          code: "custom",
          message: "同一餐次的份数和重登记标志必须一致",
          path: [index]
        });
      }
    });
  }
);

export const customerReservationItemsSchema = customerReservationItemsInputSchema.transform((items) => {
  const firstByMealSlot = new Map<string, (typeof items)[number]>();
  items.forEach((item) => {
    const key = String(item.mealSlotId);
    if (!firstByMealSlot.has(key)) firstByMealSlot.set(key, item);
  });
  return [...firstByMealSlot.values()];
}).refine((items) => items.length <= 20, { message: "一次最多登记 20 个餐次" });

export const normalizeCustomerReservationItems = (items: unknown) => customerReservationItemsSchema.parse(items);

export const customerReservationInputSchema = z.object({
  batchPublicId: z.string().uuid(),
  profile: customerReservationProfileSchema,
  displayName: shortText,
  address: addressSchema,
  items: customerReservationItemsSchema
}).strict();

export const orderSchema = z.object({
  id: relationshipIdSchema,
  sellerId: relationshipIdSchema,
  mealSlotId: relationshipIdSchema,
  customerProfileId: relationshipIdSchema,
  status: orderStatusSchema,
  source: orderSourceSchema,
  displayName: shortText,
  address: addressSchema,
  quantity: positiveIntegerSchema,
  unitPriceCents: nonNegativeIntegerSchema,
  totalCents: nonNegativeIntegerSchema,
  paymentStatus: paymentStatusSchema,
  paidAt: zonedDateTimeSchema.nullable(),
  deliveryStatus: deliveryStatusSchema,
  deliveredAt: zonedDateTimeSchema.nullable(),
  confirmedAt: zonedDateTimeSchema.nullable(),
  canceledAt: zonedDateTimeSchema.nullable(),
  note: noteSchema
}).strict().refine(
  ({ quantity, unitPriceCents, totalCents }) => quantity * unitPriceCents === totalCents,
  { message: "订单总价与份数、单价不一致" }
);

export const customerReservationOrderSchema = orderSchema.safeExtend({
  status: z.literal("draft"),
  source: z.literal("customer-card"),
  paymentStatus: z.literal("unpaid"),
  paidAt: z.null(),
  deliveryStatus: z.literal("pending"),
  deliveredAt: z.null(),
  confirmedAt: z.null(),
  canceledAt: z.null()
});

export const customerReservationResultSchema = z.discriminatedUnion("status", [
  z.object({ mealSlotId: relationshipIdSchema, status: z.literal("created"), doc: customerReservationOrderSchema }).strict(),
  z.object({ mealSlotId: relationshipIdSchema, status: z.literal("updated"), doc: customerReservationOrderSchema }).strict(),
  z.object({
    mealSlotId: relationshipIdSchema,
    status: z.literal("resubmitted"),
    doc: customerReservationOrderSchema
  }).strict(),
  z.object({
    mealSlotId: relationshipIdSchema,
    status: z.literal("failed"),
    error: z.string().trim().min(1),
    message: z.string().trim().min(1)
  }).strict()
]);

export const customerReservationResponseSchema = z.object({
  profile: customerProfileSchema.safeExtend({ active: z.literal(true) }),
  results: z.array(customerReservationResultSchema).min(1).max(20).refine(
    (results) => new Set(results.map((result) => String(result.mealSlotId))).size === results.length,
    { message: "每个餐次只能返回一个登记结果" }
  )
}).strict().refine(
  ({ profile, results }) => results.every((result) => result.status === "failed" || (
    String(result.mealSlotId) === String(result.doc.mealSlotId)
    && String(result.doc.customerProfileId) === String(profile.id)
    && String(result.doc.sellerId) === String(profile.sellerId)
  )),
  { message: "成功登记结果必须匹配餐次、商户和顾客资料" }
);

export const orderListQuerySchema = z.object({
  date: calendarDateSchema,
  occasion: occasionSchema
}).strict();

const profileChoice = {
  customerProfileId: relationshipIdSchema.optional(),
  newProfile: customerProfileCreateSchema.optional()
};

export const manualOrderCreateSchema = z.object({
  mealSlotId: relationshipIdSchema,
  ...profileChoice,
  quantity: positiveIntegerSchema,
  note: noteSchema.default(null)
}).strict().refine(
  ({ customerProfileId, newProfile }) => (customerProfileId === undefined) !== (newProfile === undefined),
  { message: "必须且只能选择一个已有顾客资料或新建顾客资料" }
);

export const manualOrderUpdateSchema = z.object({
  quantity: positiveIntegerSchema.optional(),
  displayName: shortText.optional(),
  address: addressSchema.optional(),
  note: noteSchema.optional(),
  confirmedImpactAccepted: z.literal(true).optional()
}).strict().refine(
  (value) => [value.quantity, value.displayName, value.address, value.note].some((field) => field !== undefined),
  { message: "至少更新一个订单字段" }
);

export const orderResubmitSchema = z.object({
  quantity: positiveIntegerSchema,
  displayName: shortText,
  address: addressSchema,
  note: noteSchema
}).strict();

export const orderActionSchema = z.enum([
  "confirm",
  "cancel",
  "resubmit",
  "mark-paid",
  "mark-unpaid",
  "mark-delivered",
  "mark-pending-delivery"
]);

export const cmsOrderCreateSchema = z.object({
  mealSlotId: relationshipIdSchema,
  customerProfileId: relationshipIdSchema,
  customerOpenid: z.string().trim().min(1).nullable(),
  status: z.literal("draft"),
  source: z.literal("manual"),
  displayName: shortText,
  address: addressSchema,
  quantity: positiveIntegerSchema,
  unitPriceCents: nonNegativeIntegerSchema,
  paymentStatus: z.literal("unpaid"),
  paidAt: z.null(),
  deliveryStatus: z.literal("pending"),
  deliveredAt: z.null(),
  confirmedAt: z.null(),
  canceledAt: z.null(),
  note: noteSchema
}).strict();

export const cmsCustomerOrderCreateSchema = z.object({
  mealSlotId: relationshipIdSchema,
  customerProfileId: relationshipIdSchema,
  customerOpenid: z.string().trim().min(1),
  status: z.literal("draft"),
  source: z.literal("customer-card"),
  displayName: shortText,
  address: addressSchema,
  quantity: positiveIntegerSchema,
  unitPriceCents: nonNegativeIntegerSchema,
  paymentStatus: z.literal("unpaid"),
  paidAt: z.null(),
  deliveryStatus: z.literal("pending"),
  deliveredAt: z.null(),
  confirmedAt: z.null(),
  canceledAt: z.null(),
  note: z.null()
}).strict();

export const cmsCustomerOrderUpdateSchema = z.object({
  quantity: positiveIntegerSchema.optional(),
  unitPriceCents: nonNegativeIntegerSchema.optional(),
  displayName: shortText.optional(),
  address: addressSchema.optional(),
  note: z.null().optional(),
  status: z.literal("draft").optional(),
  paymentStatus: z.literal("unpaid").optional(),
  paidAt: z.null().optional(),
  deliveryStatus: z.literal("pending").optional(),
  deliveredAt: z.null().optional(),
  confirmedAt: z.null().optional(),
  canceledAt: z.null().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "至少更新一个字段" });

export const cmsOrderUpdateSchema = z.object({
  quantity: positiveIntegerSchema.optional(),
  unitPriceCents: nonNegativeIntegerSchema.optional(),
  displayName: shortText.optional(),
  address: addressSchema.optional(),
  note: noteSchema.optional(),
  status: orderStatusSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  paidAt: zonedDateTimeSchema.nullable().optional(),
  deliveryStatus: deliveryStatusSchema.optional(),
  deliveredAt: zonedDateTimeSchema.nullable().optional(),
  confirmedAt: zonedDateTimeSchema.nullable().optional(),
  canceledAt: zonedDateTimeSchema.nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, { message: "至少更新一个字段" });

export const orderSummarySchema = z.object({
  confirmedOrders: nonNegativeIntegerSchema,
  totalQuantity: nonNegativeIntegerSchema,
  unpaid: nonNegativeIntegerSchema,
  pendingDelivery: nonNegativeIntegerSchema
}).strict();

export const orderListResponseSchema = z.object({
  mealSlot: mealSlotSchema,
  docs: z.array(orderSchema),
  summary: orderSummarySchema
}).strict();

export const orderMutationResponseSchema = z.object({
  doc: orderSchema,
  profile: customerProfileSchema
}).strict();

export const orderActionResponseSchema = z.object({ doc: orderSchema }).strict();

export const bulkMarkDeliveredInputSchema = z.object({
  ids: z.array(relationshipIdSchema).min(1).max(100).transform((ids) => [
    ...new Map(ids.map((id) => [String(id), id])).values()
  ])
}).strict();

export const bulkMarkDeliveredResultSchema = z.discriminatedUnion("status", [
  z.object({ id: relationshipIdSchema, status: z.literal("updated") }).strict(),
  z.object({
    id: relationshipIdSchema,
    status: z.literal("failed"),
    error: z.string().trim().min(1)
  }).strict()
]);

export const bulkMarkDeliveredResponseSchema = z.object({
  results: z.array(bulkMarkDeliveredResultSchema).max(100)
}).strict();

export const orderStateErrorSchema = z.object({
  error: z.enum(["invalid-order-transition", "confirmed-impact-confirmation-required"]),
  message: z.string().min(1)
}).strict();

const existingOrderSchema = z.object({
  id: relationshipIdSchema,
  status: orderStatusSchema,
  quantity: positiveIntegerSchema
}).strict();

export const orderExistsErrorSchema = z.object({
  error: z.enum(["order-exists", "canceled-order-exists"]),
  message: z.string().min(1),
  existing: existingOrderSchema
}).strict().refine(
  ({ error, existing }) => error === (existing.status === "canceled" ? "canceled-order-exists" : "order-exists"),
  { message: "重复订单错误与现有状态不一致" }
);

export type OperatorSessionData = z.infer<typeof operatorSessionSchema>;
export type AuthenticatedResponse = z.infer<typeof authenticatedResponseSchema>;
export type SellerSelectionResponse = z.infer<typeof sellerSelectionResponseSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
