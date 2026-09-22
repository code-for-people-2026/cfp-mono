import type { MealSnapshot } from "@cfp/kith-inn-contracts";

// Call only with a meal from the freshly read, schema-validated saved WeekPlan.
// Formatting cannot establish persistence or freshness; the copy entry owns that read.
export function formatMealText(meal: MealSnapshot): string | null {
  if (!meal.enabled) return null;
  const [, month, day] = meal.date.split("-");
  const weekday = "日一二三四五六"[new Date(`${meal.date}T00:00:00Z`).getUTCDay()];
  const dishes = [...meal.meat, ...meal.vegetable, ...(meal.soupOmitted ? [] : meal.soup)];
  return [`${Number(month)}.${Number(day)}号星期${weekday}${meal.mealType === "lunch" ? "午餐" : "晚餐"}预定接龙（30元）`,
    ...dishes.map((dish, index) => `${index + 1}.${dish.name}`)].join("\n");
}

export function formatMealExample(meal: MealSnapshot): string {
  return `1份${meal.mealType === "lunch" ? "午餐" : "晚餐"}`;
}
