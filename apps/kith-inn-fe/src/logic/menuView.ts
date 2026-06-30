// FE-local mirror of the week-menu contract (be: domain/menu/core.ts → GET /menu/week).
// ponytail: duplicate the shape here rather than touch be in an FE-only PR; consolidate
// into @cfp/kith-inn-shared once the menu contract is shared broadly across fe/be.

type MenuCategory = "meat" | "veg" | "soup" | "staple";
type Occasion = "lunch" | "dinner";

export type MenuDish = {
  id: string | number;
  name: string;
  category: MenuCategory;
  mainIngredient?: string;
  tags?: string[];
};

export type MenuSlot = { day: string; occasion: Occasion; dishes: MenuDish[] };

export type WeekMenu =
  | { ok: true; menu: MenuSlot[] }
  | { ok: false; reason: "pool-too-small"; missing: { category: string; needed: number; available: number; slot: string } };

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

export function occasionLabel(occasion: Occasion): string {
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
