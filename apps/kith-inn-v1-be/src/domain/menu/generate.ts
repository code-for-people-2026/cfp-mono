import type {
  MealSlot,
  MealSlotTarget,
  MenuItemSnapshot,
  Offering,
  OfferingCategory,
  RelaxedRule
} from "@cfp/kith-inn-v1-shared";

const DAY_MS = 86_400_000;
const REQUIRED: Record<OfferingCategory, number> = { meat: 2, veg: 2, soup: 1 };
const CATEGORIES: OfferingCategory[] = ["meat", "veg", "soup"];
const RULES: RelaxedRule[] = [
  "same-week-offering",
  "same-day-main-ingredient",
  "recent-offering",
  "recent-main-ingredient"
];

export type PoolShortage = {
  category: OfferingCategory;
  required: number;
  available: number;
};

export class OfferingPoolInsufficientError extends Error {
  constructor(public readonly shortages: PoolShortage[]) {
    super("菜品池分类不足");
  }
}

type Score = [number, number, number, number];

const idEquals = (left: string | number, right: string | number) => String(left) === String(right);
const dateNumber = (value: string) => Date.parse(`${value}T00:00:00.000Z`);

export function addCalendarDays(value: string, days: number): string {
  return new Date(dateNumber(value) + days * DAY_MS).toISOString().slice(0, 10);
}

function weekKey(value: string): string {
  const date = new Date(dateNumber(value));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

function recent(slotDate: string, targetDate: string): boolean {
  const days = (dateNumber(targetDate) - dateNumber(slotDate)) / DAY_MS;
  return days >= 1 && days <= 7;
}

function countItems(
  slots: MealSlot[],
  predicate: (slot: MealSlot, item: MenuItemSnapshot) => boolean
): number {
  return slots.reduce(
    (total, slot) => total + slot.menuItems.filter((item) => predicate(slot, item)).length,
    0
  );
}

function scoreOffering(
  candidate: Offering,
  target: MealSlotTarget,
  context: MealSlot[],
  selected: MenuItemSnapshot[]
): Score {
  const main = candidate.mainIngredient;
  return [
    countItems(context, (slot, item) => weekKey(slot.date) === weekKey(target.date) && idEquals(item.offeringId, candidate.id)),
    (main ? countItems(context, (slot, item) => slot.date === target.date && item.mainIngredientSnapshot === main) : 0) +
      (main ? selected.filter((item) => item.mainIngredientSnapshot === main).length : 0),
    countItems(context, (slot, item) => recent(slot.date, target.date) && idEquals(item.offeringId, candidate.id)),
    main ? countItems(context, (slot, item) => recent(slot.date, target.date) && item.mainIngredientSnapshot === main) : 0
  ];
}

function compareScore(left: Score, right: Score): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

function snapshot(candidate: Offering): MenuItemSnapshot {
  return {
    offeringId: candidate.id,
    nameSnapshot: candidate.name,
    mainIngredientSnapshot: candidate.mainIngredient,
    categorySnapshot: candidate.category
  };
}

function choose(
  candidates: Offering[],
  target: MealSlotTarget,
  context: MealSlot[],
  selected: MenuItemSnapshot[],
  random: () => number
): { item: MenuItemSnapshot; score: Score } {
  const scored = candidates.map((candidate) => ({ candidate, score: scoreOffering(candidate, target, context, selected) }));
  scored.sort((left, right) => compareScore(left.score, right.score));
  const best = scored[0]!.score;
  const tied = scored.filter(({ score }) => compareScore(score, best) === 0);
  const index = Math.min(Math.floor(Math.max(0, random()) * tied.length), tied.length - 1);
  const winner = tied[index]!;
  return { item: snapshot(winner.candidate), score: winner.score };
}

function relaxedFrom(score: Score): RelaxedRule[] {
  return RULES.filter((_, index) => score[index]! > 0);
}

function pairs(candidates: Offering[]): Array<[Offering, Offering]> {
  const result: Array<[Offering, Offering]> = [];
  for (let left = 0; left < candidates.length - 1; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      result.push([candidates[left]!, candidates[right]!]);
    }
  }
  return result;
}

function scoreMenu(items: Offering[], baseScores: Map<Offering, Score>): Score {
  const score: Score = [0, 0, 0, 0];
  items.forEach((item) => {
    baseScores.get(item)!.forEach((value, index) => { score[index]! += value; });
  });
  for (let left = 0; left < items.length - 1; left += 1) {
    const main = items[left]!.mainIngredient;
    for (let right = left + 1; right < items.length; right += 1) {
      if (main && main === items[right]!.mainIngredient) score[1] += 1;
    }
  }
  return score;
}

function chooseMenu(
  active: Offering[],
  target: MealSlotTarget,
  context: MealSlot[],
  random: () => number
): { items: MenuItemSnapshot[]; score: Score } {
  const baseScores = new Map(active.map((item) => [item, scoreOffering(item, target, context, [])]));
  const meatPairs = pairs(active.filter(({ category }) => category === "meat"));
  const vegPairs = pairs(active.filter(({ category }) => category === "veg"));
  const soups = active.filter(({ category }) => category === "soup");
  let bestItems: Offering[] | null = null;
  let bestScore: Score | null = null;
  let tied = 0;
  for (const meat of meatPairs) {
    for (const veg of vegPairs) {
      for (const soup of soups) {
        const items = [...meat, ...veg, soup];
        const score = scoreMenu(items, baseScores);
        const comparison = bestScore ? compareScore(score, bestScore) : -1;
        if (comparison < 0) {
          bestItems = items;
          bestScore = score;
          tied = 1;
        } else if (comparison === 0) {
          tied += 1;
          if (random() >= 1 - 1 / tied) bestItems = items;
        }
      }
    }
  }
  return { items: bestItems!.map(snapshot), score: bestScore! };
}

function assertPool(offerings: Offering[]): Offering[] {
  const active = offerings.filter(({ active }) => active);
  const shortages = CATEGORIES.flatMap((category) => {
    const available = active.filter((offering) => offering.category === category).length;
    return available < REQUIRED[category]
      ? [{ category, required: REQUIRED[category], available }]
      : [];
  });
  if (shortages.length > 0) throw new OfferingPoolInsufficientError(shortages);
  return active;
}

export function generateMenus({
  offerings,
  targets,
  history,
  random = Math.random
}: {
  offerings: Offering[];
  targets: MealSlotTarget[];
  history: MealSlot[];
  random?: () => number;
}): {
  menus: Array<{ target: MealSlotTarget; menuItems: MenuItemSnapshot[] }>;
  relaxedRules: RelaxedRule[];
} {
  const active = assertPool(offerings);
  const context = [...history];
  const relaxed = new Set<RelaxedRule>();
  const targetsInOrder = [...targets].sort((left, right) =>
    left.date.localeCompare(right.date) || (left.occasion === "lunch" ? -1 : 1));
  const menus = targetsInOrder.map((target, targetIndex) => {
    const picked = chooseMenu(active, target, context, random);
    const menuItems = picked.items;
    relaxedFrom(picked.score).forEach((rule) => relaxed.add(rule));
    context.push({
      id: `generated-${targetIndex}`,
      sellerId: active[0]!.sellerId,
      ...target,
      menuItems,
      orderStatus: "draft",
      orderDeadline: null,
      priceCents: null,
      generatedAt: null
    });
    return { target, menuItems };
  });
  return { menus, relaxedRules: RULES.filter((rule) => relaxed.has(rule)) };
}

export function swapMenuItem({
  slot,
  offeringId,
  offerings,
  history,
  random = Math.random
}: {
  slot: MealSlot;
  offeringId: string | number;
  offerings: Offering[];
  history: MealSlot[];
  random?: () => number;
}): { menuItems: MenuItemSnapshot[]; relaxedRules: RelaxedRule[] } | null {
  const targetIndex = slot.menuItems.findIndex((item) => idEquals(item.offeringId, offeringId));
  if (targetIndex < 0) return null;
  const targetItem = slot.menuItems[targetIndex]!;
  const currentIds = slot.menuItems.map(({ offeringId: id }) => id);
  const candidates = offerings.filter((candidate) =>
    candidate.active &&
    candidate.category === targetItem.categorySnapshot &&
    !currentIds.some((id) => idEquals(id, candidate.id)));
  if (candidates.length === 0) return null;
  const remaining = slot.menuItems.filter((_, index) => index !== targetIndex);
  const context = history.filter((item) => !idEquals(item.id, slot.id));
  const picked = choose(candidates, { date: slot.date, occasion: slot.occasion }, context, remaining, random);
  const menuItems = [...slot.menuItems];
  menuItems[targetIndex] = picked.item;
  return { menuItems, relaxedRules: relaxedFrom(picked.score) };
}
