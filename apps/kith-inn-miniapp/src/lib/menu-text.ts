import { CategorySchema, type MealSnapshot } from "@cfp/kith-inn-contracts";
import { labels } from "./classify";

// Call only with a meal from the freshly read, schema-validated saved WeekPlan.
// Formatting cannot establish persistence or freshness; the copy entry owns that read.
export function formatMealText(meal: MealSnapshot): string | null {
  if (!meal.enabled) return null;
  const [year, month, day] = meal.date.split("-");
  const weekday = "日一二三四五六"[new Date(`${meal.date}T00:00:00Z`).getUTCDay()];
  const lines = [`${year}年${Number(month)}月${Number(day)}日（周${weekday}）${meal.mealType === "lunch" ? "午餐" : "晚餐"}`];
  for (const category of CategorySchema.options) {
    if (category === "soup" && meal.soupOmitted) continue;
    if (meal[category].length) lines.push(`${labels[category]}：${meal[category].map((dish) => dish.name).join("、")}`);
  }
  return lines.join("\n");
}
