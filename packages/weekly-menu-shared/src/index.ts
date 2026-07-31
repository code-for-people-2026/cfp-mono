import {
  MEAL_LABELS,
  RECIPE_CATEGORY_TO_SLOT,
  WEEK_DAYS,
  generateWeeklyMenu,
  replaceDishInPlan,
  type DishPools,
  type DishSlot,
  type RandomFn,
  type RecipeCategory,
  type WeeklyPlan
} from "@cfp/menu-core";
import { z } from "zod";

export {
  MEAL_LABELS,
  RECIPE_CATEGORY_TO_SLOT,
  WEEK_DAYS,
  type DishPools,
  type DishSlot,
  type MealLabel,
  type RecipeCategory,
  type WeekDay,
  type WeeklyPlan
} from "@cfp/menu-core";

export const WEEKLY_MENU_CONTRACT_VERSION = 1 as const;

const recipeCategories = Object.keys(RECIPE_CATEGORY_TO_SLOT) as [
  RecipeCategory,
  ...RecipeCategory[]
];
const dishSlots = Object.values(RECIPE_CATEGORY_TO_SLOT) as [DishSlot, ...DishSlot[]];

export const recipeCategorySchema = z.enum(recipeCategories);
export const dishSlotSchema = z.enum(dishSlots);
export const weekDaySchema = z.enum(WEEK_DAYS);
export const mealLabelSchema = z.enum(MEAL_LABELS);
export const planStatusSchema = z.enum(["draft", "confirmed"]);

const dishNameSchema = z.string().trim().min(1);
export const planIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export const weekStartSchema = z.iso.date().refine(
  (value) => new Date(`${value}T00:00:00Z`).getUTCDay() === 1,
  "weekStart 必须是周一"
);
const timestampSchema = z.iso.datetime({ offset: true });

export const plannedMealSchema = z
  .object({
    label: mealLabelSchema,
    bigMeat: dishNameSchema,
    smallMeat: dishNameSchema,
    vegetable: dishNameSchema
  })
  .strict();

export const plannedDaySchema = z
  .object({
    day: weekDaySchema,
    meals: z.array(plannedMealSchema).length(MEAL_LABELS.length)
  })
  .strict();

export const weeklyPlanSchema = z
  .array(plannedDaySchema)
  .length(WEEK_DAYS.length)
  .superRefine((days, context) => {
    days.forEach((day, dayIndex) => {
      if (day.day !== WEEK_DAYS[dayIndex]) {
        context.addIssue({
          code: "custom",
          message: "菜单日期顺序无效",
          path: [dayIndex, "day"]
        });
      }
      day.meals.forEach((meal, mealIndex) => {
        if (meal.label !== MEAL_LABELS[mealIndex]) {
          context.addIssue({
            code: "custom",
            message: "餐次顺序无效",
            path: [dayIndex, "meals", mealIndex, "label"]
          });
        }
      });
    });
  });

const planBaseSchema = z
  .object({
    contractVersion: z.literal(WEEKLY_MENU_CONTRACT_VERSION),
    id: planIdSchema,
    weekStart: weekStartSchema,
    sourcePlanId: planIdSchema.nullable(),
    days: weeklyPlanSchema
  })
  .strict();

export const draftPlanDtoSchema = planBaseSchema.extend({
  status: z.literal("draft"),
  confirmedAt: z.null()
});

export const confirmedPlanDtoSchema = planBaseSchema.extend({
  status: z.literal("confirmed"),
  confirmedAt: timestampSchema
});

export const weeklyMenuPlanDtoSchema = z.discriminatedUnion("status", [
  draftPlanDtoSchema,
  confirmedPlanDtoSchema
]);

export const replaceDishInputSchema = z
  .object({
    dayIndex: z.number().int().min(0).max(WEEK_DAYS.length - 1),
    mealIndex: z.number().int().min(0).max(MEAL_LABELS.length - 1),
    slot: dishSlotSchema
  })
  .strict();

export const copyPlanInputSchema = z
  .object({
    id: planIdSchema,
    weekStart: weekStartSchema
  })
  .strict();

export const generatePlanInputSchema = z
  .object({
    weekStart: weekStartSchema
  })
  .strict();

export const planListQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).max(10_000).default(0)
  })
  .strict();

export const planListDtoSchema = z
  .object({
    contractVersion: z.literal(WEEKLY_MENU_CONTRACT_VERSION),
    items: z.array(weeklyMenuPlanDtoSchema),
    page: z
      .object({
        limit: z.number().int().min(1).max(50),
        offset: z.number().int().min(0),
        hasMore: z.boolean()
      })
      .strict()
  })
  .strict();

export const bootstrapDtoSchema = z
  .object({
    contractVersion: z.literal(WEEKLY_MENU_CONTRACT_VERSION),
    latestDraft: draftPlanDtoSchema.nullable()
  })
  .strict();

export const dishChecklistDtoSchema = z
  .object({
    contractVersion: z.literal(WEEKLY_MENU_CONTRACT_VERSION),
    planId: planIdSchema,
    items: z
      .array(z.object({ name: dishNameSchema }).strict())
      .superRefine((items, context) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          if (seen.has(item.name)) {
            context.addIssue({
              code: "custom",
              message: "菜品清单不能包含重复菜名",
              path: [index, "name"]
            });
          }
          seen.add(item.name);
        });
      })
  })
  .strict();

export type PlanStatus = z.infer<typeof planStatusSchema>;
export type PlannedMealDto = z.infer<typeof plannedMealSchema>;
export type PlannedDayDto = z.infer<typeof plannedDaySchema>;
export type DraftPlanDto = z.infer<typeof draftPlanDtoSchema>;
export type ConfirmedPlanDto = z.infer<typeof confirmedPlanDtoSchema>;
export type WeeklyMenuPlanDto = z.infer<typeof weeklyMenuPlanDtoSchema>;
export type ReplaceDishInput = z.infer<typeof replaceDishInputSchema>;
export type CopyPlanInput = z.infer<typeof copyPlanInputSchema>;
export type GeneratePlanInput = z.infer<typeof generatePlanInputSchema>;
export type PlanListQuery = z.infer<typeof planListQuerySchema>;
export type PlanListDto = z.infer<typeof planListDtoSchema>;
export type BootstrapDto = z.infer<typeof bootstrapDtoSchema>;
export type DishChecklistDto = z.infer<typeof dishChecklistDtoSchema>;

export const WEEKLY_MENU_ERROR_CODES = [
  "PLAN_FORBIDDEN",
  "PLAN_IMMUTABLE",
  "PLAN_NOT_CONFIRMED",
  "PLAN_COPY_ID_CONFLICT"
] as const;

export type WeeklyMenuErrorCode = (typeof WEEKLY_MENU_ERROR_CODES)[number];

export class WeeklyMenuDomainError extends Error {
  readonly code: WeeklyMenuErrorCode;

  constructor(code: WeeklyMenuErrorCode) {
    super(code);
    this.name = "WeeklyMenuDomainError";
    this.code = code;
  }
}

export type PlanOwnership = Readonly<{
  actorId: string;
  ownerId: string;
}>;

function assertPlanOwner(ownership: PlanOwnership): void {
  if (
    !planIdSchema.safeParse(ownership.actorId).success ||
    !planIdSchema.safeParse(ownership.ownerId).success ||
    ownership.actorId !== ownership.ownerId
  ) {
    throw new WeeklyMenuDomainError("PLAN_FORBIDDEN");
  }
}

function assertDraftPlan(plan: WeeklyMenuPlanDto): asserts plan is DraftPlanDto {
  if (plan.status !== "draft") {
    throw new WeeklyMenuDomainError("PLAN_IMMUTABLE");
  }
}

function assertConfirmedPlan(
  plan: WeeklyMenuPlanDto
): asserts plan is ConfirmedPlanDto {
  if (plan.status !== "confirmed") {
    throw new WeeklyMenuDomainError("PLAN_NOT_CONFIRMED");
  }
}

export type GenerateDraftPlanInput = Readonly<{
  id: string;
  weekStart: string;
  dishPools: DishPools;
  previousWeekPlan?: WeeklyPlan;
}>;

export function generateDraftPlan(
  input: GenerateDraftPlanInput,
  random: RandomFn = Math.random
): DraftPlanDto {
  return draftPlanDtoSchema.parse({
    contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
    id: input.id,
    weekStart: input.weekStart,
    sourcePlanId: null,
    status: "draft",
    confirmedAt: null,
    days: generateWeeklyMenu(input.dishPools, input.previousWeekPlan, random)
  });
}

export function replaceDraftPlanDish(
  plan: WeeklyMenuPlanDto,
  ownership: PlanOwnership,
  input: ReplaceDishInput,
  dishPools: DishPools,
  previousWeekPlan?: WeeklyPlan,
  random: RandomFn = Math.random
): DraftPlanDto {
  assertPlanOwner(ownership);
  assertDraftPlan(plan);
  const parsedInput = replaceDishInputSchema.parse(input);
  return {
    ...plan,
    days: replaceDishInPlan(
      plan.days,
      parsedInput.dayIndex,
      parsedInput.mealIndex,
      parsedInput.slot,
      dishPools,
      previousWeekPlan,
      random
    )
  };
}

export function confirmDraftPlan(
  plan: WeeklyMenuPlanDto,
  ownership: PlanOwnership,
  confirmedAt: string
): ConfirmedPlanDto {
  assertPlanOwner(ownership);
  assertDraftPlan(plan);
  return confirmedPlanDtoSchema.parse({
    ...plan,
    status: "confirmed",
    confirmedAt
  });
}

export function copyConfirmedPlan(
  source: WeeklyMenuPlanDto,
  ownership: PlanOwnership,
  input: CopyPlanInput
): DraftPlanDto {
  assertPlanOwner(ownership);
  assertConfirmedPlan(source);
  const parsedInput = copyPlanInputSchema.parse(input);
  if (parsedInput.id === source.id) {
    throw new WeeklyMenuDomainError("PLAN_COPY_ID_CONFLICT");
  }
  return {
    ...source,
    id: parsedInput.id,
    weekStart: parsedInput.weekStart,
    sourcePlanId: source.id,
    status: "draft",
    confirmedAt: null,
    days: source.days.map((day) => ({
      ...day,
      meals: day.meals.map((meal) => ({ ...meal }))
    }))
  };
}

export function assertPlanCanDelete(
  plan: WeeklyMenuPlanDto,
  ownership: PlanOwnership
): void {
  assertPlanOwner(ownership);
  assertDraftPlan(plan);
}

export function createDishChecklist(
  plan: WeeklyMenuPlanDto,
  ownership: PlanOwnership
): DishChecklistDto {
  assertPlanOwner(ownership);
  assertConfirmedPlan(plan);
  const seen = new Set<string>();
  const items: DishChecklistDto["items"] = [];

  for (const day of plan.days) {
    for (const meal of day.meals) {
      for (const slot of dishSlots) {
        const name = meal[slot];
        if (!seen.has(name)) {
          seen.add(name);
          items.push({ name });
        }
      }
    }
  }

  return dishChecklistDtoSchema.parse({
    contractVersion: WEEKLY_MENU_CONTRACT_VERSION,
    planId: plan.id,
    items
  });
}
