// 一周菜单生成 —— 纯逻辑，零框架依赖。
//
// 「留口子」原则：菜品池（dishPools）由调用方传入，不再 import 写死的菜名。
// 谁来调都行 —— 小程序从 CMS 拉到菜品后调它，后端拿到菜品后也调它，是同一个函数。
// 随机源（random）也做成可注入，默认 Math.random，测试时可传入确定值。

export const WEEK_DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
export const MEAL_LABELS = ["午餐", "晚餐"] as const;

export type MealLabel = (typeof MEAL_LABELS)[number];
export type WeekDay = (typeof WEEK_DAYS)[number];
export type DishSlot = "bigMeat" | "smallMeat" | "vegetable";

export type PlannedMeal = {
  label: MealLabel;
  bigMeat: string;
  smallMeat: string;
  vegetable: string;
};

export type PlannedDay = {
  day: WeekDay;
  meals: PlannedMeal[];
};

export type WeeklyPlan = PlannedDay[];

// ★ 口子：每个分类的菜品池，由外部数据源（CMS / 缓存 / 测试桩）提供。
export type DishPools = Record<DishSlot, readonly string[]>;

export type RandomFn = () => number;

const SLOTS: readonly DishSlot[] = ["bigMeat", "smallMeat", "vegetable"];

// 归一化菜品池：去空白、去重，保持顺序。
function normalizePool(pool: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of pool) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function shuffle<T>(items: readonly T[], random: RandomFn): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    // i 在 (0, length)，j 在 [0, i]，两者都在界内。
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

function flattenSlot(plan: WeeklyPlan | null | undefined, slot: DishSlot): string[] {
  if (!plan) {
    return [];
  }
  const flattened: string[] = [];
  for (const day of plan) {
    for (const meal of day.meals) {
      flattened.push(meal[slot]);
    }
  }
  return flattened;
}

function indexPreviousSequence(previousSequence: readonly string[]): Map<string, number[]> {
  const previousIndexes = new Map<string, number[]>();
  previousSequence.forEach((dish, index) => {
    const list = previousIndexes.get(dish);
    if (list) {
      list.push(index);
      return;
    }
    previousIndexes.set(dish, [index]);
  });
  return previousIndexes;
}

function minDistanceFromIndexes(indexes: number[] | undefined, target: number): number {
  if (indexes === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const index of indexes) {
    best = Math.min(best, Math.abs(target - index));
  }
  return best;
}

// 候选排序：① 优先没在上周出现过的 ② 本周用得少的 ③ 离上周同位置更远的 ④ 随机打散。
function rankCandidate(
  left: string,
  right: string,
  position: number,
  previousIndexes: Map<string, number[]>,
  usage: Map<string, number>,
  random: RandomFn
): number {
  const leftRepeatedLastWeek = previousIndexes.has(left) ? 1 : 0;
  const rightRepeatedLastWeek = previousIndexes.has(right) ? 1 : 0;
  if (leftRepeatedLastWeek !== rightRepeatedLastWeek) {
    return leftRepeatedLastWeek - rightRepeatedLastWeek;
  }

  const leftUsage = usage.get(left) ?? 0;
  const rightUsage = usage.get(right) ?? 0;
  if (leftUsage !== rightUsage) {
    return leftUsage - rightUsage;
  }

  const leftDistance = minDistanceFromIndexes(previousIndexes.get(left), position);
  const rightDistance = minDistanceFromIndexes(previousIndexes.get(right), position);
  if (leftDistance !== rightDistance) {
    return rightDistance - leftDistance;
  }

  return random() - 0.5;
}

function buildSequenceWithHistory(
  pool: readonly string[],
  total: number,
  previousSequence: readonly string[],
  random: RandomFn
): string[] {
  const previousIndexes = indexPreviousSequence(previousSequence);
  const currentUsage = new Map<string, number>();
  const sequence: string[] = [];

  for (let position = 0; position < total; position += 1) {
    const candidates = shuffle(pool, random);
    const previousDish = sequence[position - 1];

    candidates.sort((left, right) =>
      rankCandidate(left, right, position, previousIndexes, currentUsage, random)
    );

    // pool 非空（已在 generateWeeklyMenu 校验），candidates[0] 必然存在。
    const chosen = candidates.find((dish) => dish !== previousDish) ?? candidates[0]!;
    sequence.push(chosen);
    currentUsage.set(chosen, (currentUsage.get(chosen) ?? 0) + 1);
  }

  return sequence;
}

function resolvePools(dishPools: DishPools): Record<DishSlot, string[]> {
  const resolved: Record<DishSlot, string[]> = {
    bigMeat: normalizePool(dishPools.bigMeat),
    smallMeat: normalizePool(dishPools.smallMeat),
    vegetable: normalizePool(dishPools.vegetable)
  };
  for (const slot of SLOTS) {
    if (resolved[slot].length === 0) {
      throw new Error(`菜谱库分类「${slot}」为空，无法生成菜单`);
    }
  }
  return resolved;
}

export function generateWeeklyMenu(
  dishPools: DishPools,
  previousWeekPlan?: WeeklyPlan,
  random: RandomFn = Math.random
): PlannedDay[] {
  const pools = resolvePools(dishPools);
  const totalMeals = WEEK_DAYS.length * MEAL_LABELS.length;

  const sequences: Record<DishSlot, string[]> = {
    bigMeat: buildSequenceWithHistory(
      pools.bigMeat,
      totalMeals,
      flattenSlot(previousWeekPlan, "bigMeat"),
      random
    ),
    smallMeat: buildSequenceWithHistory(
      pools.smallMeat,
      totalMeals,
      flattenSlot(previousWeekPlan, "smallMeat"),
      random
    ),
    vegetable: buildSequenceWithHistory(
      pools.vegetable,
      totalMeals,
      flattenSlot(previousWeekPlan, "vegetable"),
      random
    )
  };

  return WEEK_DAYS.map((day, dayIndex) => {
    const meals = MEAL_LABELS.map((label, mealIndex) => {
      const index = dayIndex * MEAL_LABELS.length + mealIndex;
      return {
        label,
        bigMeat: sequences.bigMeat[index]!,
        smallMeat: sequences.smallMeat[index]!,
        vegetable: sequences.vegetable[index]!
      };
    });
    return { day, meals };
  });
}

function countSlotUsage(plan: PlannedDay[], slot: DishSlot): Map<string, number> {
  const usage = new Map<string, number>();
  for (const day of plan) {
    for (const meal of day.meals) {
      const dishName = meal[slot];
      usage.set(dishName, (usage.get(dishName) ?? 0) + 1);
    }
  }
  return usage;
}

export function replaceDishInPlan(
  plan: PlannedDay[],
  dayIndex: number,
  mealIndex: number,
  slot: DishSlot,
  dishPools: DishPools,
  previousWeekPlan?: WeeklyPlan,
  random: RandomFn = Math.random
): PlannedDay[] {
  const meal = plan[dayIndex]?.meals[mealIndex];
  if (!meal) {
    return plan;
  }

  const currentDish = meal[slot];
  const pool = normalizePool(dishPools[slot]);
  const candidates = pool.filter((dish) => dish !== currentDish);
  if (candidates.length === 0) {
    return plan;
  }

  const usage = countSlotUsage(plan, slot);
  const targetPosition = dayIndex * MEAL_LABELS.length + mealIndex;
  const previousIndexes = indexPreviousSequence(flattenSlot(previousWeekPlan, slot));

  const ranked = shuffle(candidates, random).sort((left, right) =>
    rankCandidate(left, right, targetPosition, previousIndexes, usage, random)
  );
  const replacement = ranked[0]!;

  return plan.map((dayItem, dIndex) => {
    if (dIndex !== dayIndex) {
      return dayItem;
    }
    return {
      ...dayItem,
      meals: dayItem.meals.map((mealItem, mIndex) =>
        mIndex === mealIndex ? { ...mealItem, [slot]: replacement } : mealItem
      )
    };
  });
}
