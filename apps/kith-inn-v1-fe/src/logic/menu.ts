import type {
  MealSlot,
  MealSlotTarget,
  Occasion,
  RelaxedRule
} from "@cfp/kith-inn-v1-shared";
import { ApiError } from "../services/api";

const DAY_MS = 86_400_000;
const RULE_LABELS: Record<RelaxedRule, string> = {
  "same-week-offering": "同周不重复菜",
  "same-day-main-ingredient": "同日不重复主料",
  "recent-offering": "近 7 日不重复菜",
  "recent-main-ingredient": "近 7 日不重复主料"
};
const RULE_ORDER = Object.keys(RULE_LABELS) as RelaxedRule[];
const CATEGORY_LABELS = { meat: "荤菜", veg: "素菜", soup: "汤" } as const;

type PoolShortage = {
  category: keyof typeof CATEGORY_LABELS;
  required: number;
  available: number;
};

function poolShortages(value: unknown): PoolShortage[] {
  if (typeof value !== "object" || value === null || !("shortages" in value) ||
    !Array.isArray(value.shortages)) return [];
  return value.shortages.filter((shortage): shortage is PoolShortage => {
    if (typeof shortage !== "object" || shortage === null) return false;
    const item = shortage as Record<string, unknown>;
    return typeof item.category === "string" && item.category in CATEGORY_LABELS &&
      Number.isInteger(item.required) && Number.isInteger(item.available);
  });
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

export function generationErrorText(error: unknown): string {
  const fallback = error instanceof Error ? error.message : "菜单生成失败";
  if (!(error instanceof ApiError) || error.code !== "offering-pool-insufficient") return fallback;
  const shortages = poolShortages(error.data);
  return shortages.length === 0
    ? fallback
    : `菜品池不足：${shortages.map(({ category, required, available }) =>
      `${CATEGORY_LABELS[category]}缺 ${Math.max(0, required - available)} 道（需 ${required}，现有 ${available}）`
    ).join("、")}`;
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
