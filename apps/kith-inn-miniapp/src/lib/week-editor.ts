import { type Category, type Dish, type MealSnapshot, type MenuPreview, type WeekWriteInput } from "@cfp/kith-inn-contracts";

export class WeekEditError extends Error {
  constructor(readonly code: "INVALID_POSITION" | "NO_REPLACEMENT" | "SOUP_RESELECTION_REQUIRED") {
    super({ INVALID_POSITION: "请重新选择要调整的菜位", NO_REPLACEMENT: "没有其他可用的同类菜，请先补充菜品池",
      SOUP_RESELECTION_REQUIRED: "原汤已停用或改类，请重新选齐可用汤后恢复" }[code]);
  }
}
const categories: Category[] = ["meat", "vegetable", "soup"];
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function replacementCandidates(meal: MealSnapshot, category: Category, index: number, dishes: Dish[]): Dish[] {
  if (!meal.enabled || !meal[category][index]) throw new WeekEditError("INVALID_POSITION");
  const used = new Set(categories.flatMap((c) => meal[c].map((item) => item.dishId.toLowerCase())));
  return dishes.filter((dish) => dish.active && dish.category === category && !used.has(dish.id.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}
function mealAt(menu: MenuPreview, index: number) {
  const meal = menu.meals[index];
  if (!meal?.enabled) throw new WeekEditError("INVALID_POSITION");
  return meal;
}
function withMeal(menu: MenuPreview, index: number, meal: MealSnapshot): MenuPreview {
  return { ...menu, meals: menu.meals.map((original, i) => i === index ? meal : original) };
}
export function replaceDish(menu: MenuPreview, mealIndex: number, category: Category, index: number, dishId: string, dishes: Dish[]): MenuPreview {
  const meal = mealAt(menu, mealIndex);
  const dish = replacementCandidates(meal, category, index, dishes).find((candidate) => sameId(candidate.id, dishId));
  if (!dish) throw new WeekEditError("NO_REPLACEMENT");
  return withMeal(menu, mealIndex, { ...meal, [category]: meal[category].map((item, i) => i === index ? { dishId: dish.id, name: dish.name } : item) });
}
export function randomReplaceDish(menu: MenuPreview, mealIndex: number, category: Category, index: number, dishes: Dish[], random = Math.random): MenuPreview {
  const candidates = replacementCandidates(mealAt(menu, mealIndex), category, index, dishes);
  if (!candidates.length) throw new WeekEditError("NO_REPLACEMENT");
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new WeekEditError("NO_REPLACEMENT");
  return replaceDish(menu, mealIndex, category, index, candidates[Math.floor(value * candidates.length)]!.id, dishes);
}
export function restoreSoup(menu: MenuPreview, mealIndex: number, dishIds: string[], dishes: Dish[]): MenuPreview {
  const meal = mealAt(menu, mealIndex);
  const used = new Set([...meal.meat, ...meal.vegetable].map((item) => item.dishId.toLowerCase()));
  if (!menu.structure.soup || dishIds.length !== menu.structure.soup) throw new WeekEditError("SOUP_RESELECTION_REQUIRED");
  const soup = dishIds.map((id) => {
    const dish = dishes.find((candidate) => sameId(candidate.id, id) && candidate.active && candidate.category === "soup");
    if (!dish || used.has(id.toLowerCase())) throw new WeekEditError("SOUP_RESELECTION_REQUIRED");
    used.add(id.toLowerCase());
    return { dishId: dish.id, name: dish.name };
  });
  return withMeal(menu, mealIndex, { ...meal, soup, soupOmitted: false });
}
export function setSoupOmitted(menu: MenuPreview, mealIndex: number, omitted: boolean, dishes: Dish[]): MenuPreview {
  const meal = mealAt(menu, mealIndex);
  if (!menu.structure.soup) throw new WeekEditError("INVALID_POSITION");
  return omitted ? withMeal(menu, mealIndex, { ...meal, soupOmitted: true })
    : restoreSoup(menu, mealIndex, meal.soup.map((item) => item.dishId), dishes);
}
export function toWeekWriteInput(menu: MenuPreview, baseVersion: number, rebuild: boolean, confirm: boolean): WeekWriteInput {
  return { baseVersion, rebuild, confirm, structure: { ...menu.structure }, meals: menu.meals.map((meal) => ({
    date: meal.date, mealType: meal.mealType, enabled: meal.enabled, soupOmitted: meal.soupOmitted,
    meat: meal.meat.map((item) => item.dishId), vegetable: meal.vegetable.map((item) => item.dishId), soup: meal.soup.map((item) => item.dishId)
  })) };
}
