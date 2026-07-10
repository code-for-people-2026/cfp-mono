import type {
  MealSlot,
  MealSlotTarget,
  Occasion,
  RelaxedRule
} from "@cfp/kith-inn-v1-shared";

const DAY_MS = 86_400_000;
const RULE_LABELS: Record<RelaxedRule, string> = {
  "same-week-offering": "同周不重复菜",
  "same-day-main-ingredient": "同日不重复主料",
  "recent-offering": "近 7 日不重复菜",
  "recent-main-ingredient": "近 7 日不重复主料"
};
const RULE_ORDER = Object.keys(RULE_LABELS) as RelaxedRule[];

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

export function buildSingleTarget(date: string, occasion: Occasion): MealSlotTarget[] {
  return validDate(date) ? [{ date, occasion }] : [];
}

export function buildMenuRange(date: string): { from: string; to: string } | null {
  if (!validDate(date)) return null;
  return {
    from: date,
    to: new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 30 * DAY_MS).toISOString().slice(0, 10)
  };
}

export function buildWorkWeekTargets(date: string, occasions: Occasion[]): MealSlotTarget[] {
  if (!validDate(date) || occasions.length === 0) return [];
  const targets: MealSlotTarget[] = [];
  let cursor = new Date(`${date}T00:00:00.000Z`);
  while (targets.length < 5 * occasions.length) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      const value = cursor.toISOString().slice(0, 10);
      occasions.forEach((occasion) => targets.push({ date: value, occasion }));
    }
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return targets;
}

export function needsReplaceConfirmation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "meal-slots-exist";
}

export function relaxedRulesText(rules: RelaxedRule[]): string {
  const labels = RULE_ORDER.filter((rule) => rules.includes(rule)).map((rule) => RULE_LABELS[rule]);
  return labels.length > 0 ? `已放宽：${labels.join("、")}` : "";
}

export function replaceMealSlot(slots: MealSlot[], replacement: MealSlot): MealSlot[] {
  const remaining = slots.filter((slot) => String(slot.id) !== String(replacement.id));
  return [...remaining, replacement].sort((left, right) =>
    left.date.localeCompare(right.date) || (left.occasion === "lunch" ? -1 : 1));
}
