import { z } from "zod";

export const CategorySchema = z.enum(["meat", "vegetable", "soup"]);
export const MealTypeSchema = z.enum(["lunch", "dinner"]);
export const IdSchema = z.uuid();
export const DateSchema = z.iso.date();
export const WeekStartSchema = DateSchema.refine(
  (value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1,
  "Expected a Monday",
);
const timestamp = z.iso.datetime({ offset: true });
const version = z.int().min(1);
export const DishNameSchema = z.string().refine(
  (value) => value === value.trim().normalize("NFC") &&
    [...value].length >= 1 && [...value].length <= 60 && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value),
  "Expected a normalized name of 1–60 Unicode code points without control characters",
);
export const StructureSchema = z.strictObject({
  meat: z.int().min(0).max(10), vegetable: z.int().min(0).max(10), soup: z.int().min(0).max(10),
}).refine((s) => s.meat + s.vegetable + s.soup >= 1 && s.meat + s.vegetable + s.soup <= 20);
export const DishInputSchema = z.strictObject({ name: DishNameSchema, category: CategorySchema });
export const DishSchema = z.strictObject({
  ...DishInputSchema.shape, id: IdSchema, active: z.boolean(), version,
  createdAt: timestamp, updatedAt: timestamp,
});
export const DishListSchema = z.strictObject({ items: z.array(DishSchema).max(1000) });
export const DishBatchInputSchema = z.strictObject({ items: z.array(DishInputSchema).min(1).max(200) });
export const DishBatchResultSchema = z.strictObject({ items: z.array(DishSchema).min(1).max(200) });
export const DishUpdateInputSchema = z.strictObject({
  ...DishInputSchema.shape, baseVersion: version, active: z.boolean(),
});
export const SnapshotItemSchema = z.strictObject({ dishId: IdSchema, name: DishNameSchema });
export const MealSelectionSchema = z.strictObject({ date: DateSchema, mealType: MealTypeSchema, enabled: z.boolean() });
export const MealInputSchema = z.strictObject({
  ...MealSelectionSchema.shape, soupOmitted: z.boolean(),
  meat: z.array(IdSchema).max(10), vegetable: z.array(IdSchema).max(10), soup: z.array(IdSchema).max(10),
});
export const MealSnapshotSchema = z.strictObject({
  ...MealSelectionSchema.shape, soupOmitted: z.boolean(),
  meat: z.array(SnapshotItemSchema).max(10), vegetable: z.array(SnapshotItemSchema).max(10), soup: z.array(SnapshotItemSchema).max(10),
});
type Selection = z.infer<typeof MealSelectionSchema>;
// Dates are calendar values, never local-time instants; UTC arithmetic avoids DST shifts.
function orderedWeek(meals: Selection[]) {
  const first = meals[0]?.date;
  if (!WeekStartSchema.safeParse(first).success) return false;
  const start = Date.parse(`${first}T00:00:00Z`);
  return meals.every((meal, i) => meal.date === new Date(start + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10)
    && meal.mealType === (i % 2 === 0 ? "lunch" : "dinner"));
}
const selections = z.array(MealSelectionSchema).length(14).refine(orderedWeek);
const inputs = z.array(MealInputSchema).length(14).refine(orderedWeek);
const snapshots = z.array(MealSnapshotSchema).length(14).refine(orderedWeek);
type MenuShape = {
  structure: z.infer<typeof StructureSchema>;
  meals: (z.infer<typeof MealInputSchema> | z.infer<typeof MealSnapshotSchema>)[];
};
function completeMeals({ structure, meals }: MenuShape) {
  return meals.every((meal) => {
    const all = [...meal.meat, ...meal.vegetable, ...meal.soup];
    if (!meal.enabled) return all.length === 0 && !meal.soupOmitted;
    const ids = all.map((item) => typeof item === "string" ? item : item.dishId);
    return CategorySchema.options.every((category) => meal[category].length === structure[category])
      && new Set(ids).size === ids.length && (!meal.soupOmitted || structure.soup > 0);
  });
}
export const GenerateInputSchema = z.strictObject({ structure: StructureSchema, meals: selections });
const previewShape = { weekStart: WeekStartSchema, structure: StructureSchema, meals: snapshots };
const matchingWeek = (value: { weekStart: string; meals: Selection[] }) => value.meals[0]?.date === value.weekStart;
export const MenuPreviewSchema = z.strictObject(previewShape).refine(completeMeals).refine(matchingWeek);
export const WeekPlanSchema = z.strictObject({
  ...previewShape, id: IdSchema, version, confirmedAt: timestamp.nullable(), createdAt: timestamp, updatedAt: timestamp,
}).refine(completeMeals).refine(matchingWeek);
export const WeekWriteInputSchema = z.strictObject({
  baseVersion: z.int().min(0), rebuild: z.boolean(), confirm: z.boolean(), structure: StructureSchema, meals: inputs,
}).refine(completeMeals).refine((value) => value.baseVersion !== 0 || value.rebuild);
// The HTTP layer must match the path weekStart to meals[0].date. Ownership, active
// dishes, snapshot retention, structure changes and CAS require the database transaction.
export const WeekSummarySchema = z.strictObject({
  weekStart: WeekStartSchema, version, confirmedAt: timestamp.nullable(), updatedAt: timestamp,
});
export const WeekListSchema = z.strictObject({ items: z.array(WeekSummarySchema).max(52), nextBefore: WeekStartSchema.nullable() });
export const WeekListQuerySchema = z.strictObject({ limit: z.int().min(1).max(52).default(12), before: WeekStartSchema.optional() });
export const LoginInputSchema = z.strictObject({ code: z.string().min(1).max(256) });
export const SessionSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: timestamp });
const shortage = z.strictObject({ category: CategorySchema, required: z.int().min(1), available: z.int().min(0) })
  .refine((value) => value.available < value.required);
export const ErrorDetailsSchema = z.strictObject({
  field: z.string().optional(), currentVersion: z.int().min(0).optional(), names: z.array(DishNameSchema).max(200).optional(),
  shortages: z.array(shortage).min(1).max(3).refine((values) => new Set(values.map((v) => v.category)).size === values.length).optional(),
});
export const ErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DUPLICATE_DISH_NAME", "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED", "DISH_UNAVAILABLE", "INSUFFICIENT_DISHES", "LIMIT_EXCEEDED", "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED", "WECHAT_LOGIN_FAILED", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
]);
export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: ErrorCodeSchema, message: z.string().min(1), requestId: IdSchema, details: ErrorDetailsSchema.optional() })
    .refine((value) => value.code !== "INSUFFICIENT_DISHES" || value.details?.shortages !== undefined),
});
export const HealthSchema = z.strictObject({ status: z.enum(["ok", "ready"]) });

export type Category = z.infer<typeof CategorySchema>;
export type MealType = z.infer<typeof MealTypeSchema>;
export type Structure = z.infer<typeof StructureSchema>;
export type DishInput = z.infer<typeof DishInputSchema>;
export type Dish = z.infer<typeof DishSchema>;
export type DishList = z.infer<typeof DishListSchema>;
export type DishBatchInput = z.infer<typeof DishBatchInputSchema>;
export type DishBatchResult = z.infer<typeof DishBatchResultSchema>;
export type DishUpdateInput = z.infer<typeof DishUpdateInputSchema>;
export type SnapshotItem = z.infer<typeof SnapshotItemSchema>;
export type MealSelection = z.infer<typeof MealSelectionSchema>;
export type MealInput = z.infer<typeof MealInputSchema>;
export type MealSnapshot = z.infer<typeof MealSnapshotSchema>;
export type GenerateInput = z.infer<typeof GenerateInputSchema>;
export type MenuPreview = z.infer<typeof MenuPreviewSchema>;
export type WeekPlan = z.infer<typeof WeekPlanSchema>;
export type WeekWriteInput = z.infer<typeof WeekWriteInputSchema>;
export type WeekSummary = z.infer<typeof WeekSummarySchema>;
export type WeekList = z.infer<typeof WeekListSchema>;
export type WeekListQuery = z.infer<typeof WeekListQuerySchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type Health = z.infer<typeof HealthSchema>;
