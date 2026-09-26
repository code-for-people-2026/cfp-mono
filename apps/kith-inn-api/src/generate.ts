import {
  CategorySchema, DishListSchema, GenerateInputSchema, WeekStartSchema, dishDistances,
  type Dish, type GenerateInput, type MealSnapshot, type MenuPreview,
} from "@cfp/kith-inn-contracts";
import { ApiError } from "./auth";

// Pure preview: callers supply the current merchant's pool; no saved week is touched.
export function generateMenu(
  weekStart: string, input: GenerateInput, dishes: readonly Dish[], random: () => number = Math.random,
  adjacentMeals: readonly MealSnapshot[] = [],
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

  const arranged = [...adjacentMeals];
  return {
    weekStart, structure,
    meals: meals.map((selection) => {
      const meal: MealSnapshot = { ...selection, soupOmitted: false, meat: [], vegetable: [], soup: [] };
      if (!meal.enabled) return meal;
      const nearest = dishDistances(selection, arranged);
      for (const category of categories) {
        for (let slot = 0; slot < structure[category]; slot++) {
          // Unused dishes rank first; otherwise maximize the nearest occurrence's
          // distance, including saved weeks on both sides of this preview.
          // Ties use the supplied random source, without modifying the input pool.
          const distance = (dish: Dish) => nearest.get(dish.id.toLowerCase()) ?? Infinity;
          const candidates = available[category].filter((dish) => distance(dish) !== 0);
          const farthest = Math.max(...candidates.map(distance));
          const tied = candidates.filter((dish) => distance(dish) === farthest);
          const sample = random();
          if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
            throw new RangeError("Expected a random value in [0, 1)");
          }
          const selected = tied[Math.floor(sample * tied.length)]!;
          meal[category].push({ dishId: selected.id, name: selected.name });
          nearest.set(selected.id.toLowerCase(), 0);
        }
      }
      arranged.push(meal);
      return meal;
    }),
  };
}
