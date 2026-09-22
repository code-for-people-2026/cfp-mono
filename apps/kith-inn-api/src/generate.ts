import {
  CategorySchema, DishListSchema, GenerateInputSchema, WeekStartSchema,
  type Dish, type GenerateInput, type MealSnapshot, type MenuPreview,
} from "@cfp/kith-inn-contracts";
import { ApiError } from "./auth";

// Pure preview: callers supply the current merchant's pool; no saved week is touched.
export function generateMenu(
  weekStart: string, input: GenerateInput, dishes: readonly Dish[], random: () => number = Math.random,
): MenuPreview {
  const parsed = GenerateInputSchema.safeParse(input);
  const pool = DishListSchema.safeParse({ items: dishes });
  if (!WeekStartSchema.safeParse(weekStart).success || !parsed.success ||
      parsed.data.meals[0]?.date !== weekStart || !pool.success ||
      new Set(pool.data.items.map((dish) => dish.id.toLowerCase())).size !== dishes.length) {
    throw new ApiError(400, "INVALID_REQUEST", "周菜单设置或菜品池格式不正确");
  }
  const { structure, meals } = parsed.data;
  const categories = CategorySchema.options;
  const available = Object.fromEntries(categories.map((category) =>
    [category, pool.data.items.filter((dish) => dish.active && dish.category === category)]
  )) as Record<typeof categories[number], Dish[]>;
  const shortages = categories.filter((category) => available[category].length < structure[category])
    .map((category) => ({ category, required: structure[category], available: available[category].length }));
  if (meals.some((meal) => meal.enabled) && shortages.length) {
    throw new ApiError(422, "INSUFFICIENT_DISHES", "菜品不足以安排一餐，请补菜或调整结构", { shortages });
  }

  const lastUsed = new Map<string, number>();
  return {
    weekStart, structure,
    meals: meals.map((selection, mealIndex) => {
      const meal: MealSnapshot = { ...selection, soupOmitted: false, meat: [], vegetable: [], soup: [] };
      if (!meal.enabled) return meal;
      for (const category of categories) {
        for (let slot = 0; slot < structure[category]; slot++) {
          // Unused dishes rank first; otherwise take the least recently used.
          // Ties use the supplied random source, without modifying the input pool.
          const candidates = available[category].filter((dish) => lastUsed.get(dish.id) !== mealIndex);
          const oldest = Math.min(...candidates.map((dish) => lastUsed.get(dish.id) ?? -1));
          const tied = candidates.filter((dish) => (lastUsed.get(dish.id) ?? -1) === oldest);
          const sample = random();
          if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
            throw new RangeError("Expected a random value in [0, 1)");
          }
          const selected = tied[Math.floor(sample * tied.length)]!;
          meal[category].push({ dishId: selected.id, name: selected.name });
          lastUsed.set(selected.id, mealIndex);
        }
      }
      return meal;
    }),
  };
}
