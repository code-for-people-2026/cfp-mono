// FE view helpers for the week-menu contract (GET /menu/week). Types come from
// @cfp/kith-inn-shared (#89 PR B); only presentation logic lives here.
import type { MealOccasion, MenuDish } from "@cfp/kith-inn-shared";

export type { MenuDish, MenuSlot, WeekMenu } from "@cfp/kith-inn-shared";

const DAY_LABELS: Record<string, string> = {
  mon: "周一",
  tue: "周二",
  wed: "周三",
  thu: "周四",
  fri: "周五",
  sat: "周六",
  sun: "周日",
};

/** "mon".."sun" → "周一".."周日"; unknown keys pass through. */
export function dayLabel(day: string): string {
  return DAY_LABELS[day] ?? day;
}

export function occasionLabel(occasion: MealOccasion): string {
  return occasion === "lunch" ? "午餐" : "晚餐";
}

export type ChipTone = "red" | "amber" | "green" | "blue";
type DishChip = { label: string; tone: ChipTone };

/**
 * Chips for a dish, in display order: main ingredient (red) → 汤 (blue, for soup) →
 * tags (费工=amber, 清淡=green, anything else=green). Mirrors the prototype's chip palette.
 */
export function dishChips(dish: MenuDish): DishChip[] {
  const chips: DishChip[] = [];
  if (dish.mainIngredient) chips.push({ label: dish.mainIngredient, tone: "red" });
  if (dish.category === "soup") chips.push({ label: "汤", tone: "blue" });
  for (const tag of dish.tags ?? []) {
    if (tag === "费工") chips.push({ label: "费工", tone: "amber" });
    else if (tag === "清淡") chips.push({ label: "清淡", tone: "green" });
    else chips.push({ label: tag, tone: "green" });
  }
  return chips;
}

/** "M/D-M/D" for the Mon–Fri week containing `today` (date-only, ignores time/tz). */
export function formatWeekRange(today: Date): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekday = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - weekday);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const md = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}`;
  return `${md(monday)}-${md(friday)}`;
}
