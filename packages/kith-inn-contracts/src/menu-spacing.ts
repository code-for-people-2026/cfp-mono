import type { MealSelection, MealSnapshot } from "./index";

const dayMs = 86_400_000;
export function adjacentWeekStarts(weekStart: string): string[] {
  return [-7, 7].map((days) => new Date(Date.parse(`${weekStart}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10));
}

// Calendar lunch/dinner positions keep skipped meals and week/year boundaries
// consistent for both generation and replacement. Missing IDs have infinite spacing.
export function dishDistances(target: MealSelection, meals: readonly MealSnapshot[]): Map<string, number> {
  const position = (meal: MealSelection) => Date.parse(`${meal.date}T00:00:00Z`) / dayMs * 2 + (meal.mealType === "dinner" ? 1 : 0);
  const at = position(target), nearest = new Map<string, number>();
  for (const meal of meals) {
    if (!meal.enabled) continue;
    const distance = Math.abs(position(meal) - at);
    for (const category of ["meat", "vegetable", "soup"] as const) {
      if (category === "soup" && meal.soupOmitted) continue;
      for (const item of meal[category]) {
        const id = item.dishId.toLowerCase();
        nearest.set(id, Math.min(nearest.get(id) ?? Infinity, distance));
      }
    }
  }
  return nearest;
}
