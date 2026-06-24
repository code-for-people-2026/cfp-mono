import { describe, expect, it } from "vitest";
import {
  generateWeeklyMenu,
  MEAL_LABELS,
  RECIPE_CATEGORY_TO_SLOT,
  replaceDishInPlan,
  WEEK_DAYS,
  type DishPools,
  type DishSlot,
  type PlannedDay,
  type WeeklyPlan
} from "./generator";

const pools: DishPools = {
  bigMeat: ["大荤A", "大荤B", "大荤C", "大荤D"],
  smallMeat: ["小荤A", "小荤B", "小荤C", "小荤D"],
  vegetable: ["素A", "素B", "素C", "素D"]
};

const TOTAL_MEALS = WEEK_DAYS.length * MEAL_LABELS.length;

// 顺序循环的可控随机源，方便确定性地覆盖分支。
function seqRandom(values: number[]): () => number {
  let cursor = 0;
  return () => {
    const value = values[cursor % values.length]!;
    cursor += 1;
    return value;
  };
}

// 用每个 slot 的 14 长序列手搓一个 WeeklyPlan，便于精确控制「上周」历史。
function makePlan(sequences: Record<DishSlot, string[]>): WeeklyPlan {
  return WEEK_DAYS.map((day, dayIndex) => ({
    day,
    meals: MEAL_LABELS.map((label, mealIndex) => {
      const index = dayIndex * MEAL_LABELS.length + mealIndex;
      return {
        label,
        bigMeat: sequences.bigMeat[index]!,
        smallMeat: sequences.smallMeat[index]!,
        vegetable: sequences.vegetable[index]!
      };
    })
  }));
}

function flatten(plan: PlannedDay[], slot: DishSlot): string[] {
  return plan.flatMap((day) => day.meals.map((meal) => meal[slot]));
}

describe("RECIPE_CATEGORY_TO_SLOT", () => {
  it("把每个 CMS 分类映射到合法的 DishPools 槽位", () => {
    expect(RECIPE_CATEGORY_TO_SLOT).toEqual({
      "big-meat": "bigMeat",
      "small-meat": "smallMeat",
      vegetable: "vegetable"
    });
  });
});

describe("generateWeeklyMenu", () => {
  it("生成 7 天 × 2 餐，每个槽位都填了池中的菜", () => {
    const plan = generateWeeklyMenu(pools, undefined, seqRandom([0.1, 0.4, 0.7]));
    expect(plan).toHaveLength(WEEK_DAYS.length);
    for (const day of plan) {
      expect(day.meals).toHaveLength(MEAL_LABELS.length);
      for (const meal of day.meals) {
        expect(pools.bigMeat).toContain(meal.bigMeat);
        expect(pools.smallMeat).toContain(meal.smallMeat);
        expect(pools.vegetable).toContain(meal.vegetable);
      }
    }
  });

  it("归一化菜品池：去空白、去重", () => {
    const messyPools: DishPools = {
      bigMeat: ["  大荤A  ", "大荤A", "", "大荤B"],
      smallMeat: ["小荤A", "小荤B"],
      vegetable: ["素A", "素B"]
    };
    const plan = generateWeeklyMenu(messyPools, undefined, seqRandom([0.2, 0.8]));
    const usedBigMeat = new Set(flatten(plan, "bigMeat"));
    for (const name of usedBigMeat) {
      expect(["大荤A", "大荤B"]).toContain(name);
    }
  });

  it("某分类为空时抛错", () => {
    expect(() =>
      generateWeeklyMenu({ ...pools, vegetable: ["   ", ""] })
    ).toThrow("无法生成菜单");
  });

  it("考虑上周计划（带历史时仍生成完整结构）", () => {
    const previous = generateWeeklyMenu(pools, undefined, seqRandom([0.3, 0.6]));
    const plan = generateWeeklyMenu(pools, previous, seqRandom([0.15, 0.55, 0.95]));
    expect(flatten(plan, "bigMeat")).toHaveLength(TOTAL_MEALS);
  });

  it("默认使用 Math.random（不传随机源也能跑）", () => {
    const plan = generateWeeklyMenu(pools);
    expect(plan).toHaveLength(WEEK_DAYS.length);
  });

  it("某分类只有一道菜时，整周都用它（覆盖无其它候选的兜底）", () => {
    const plan = generateWeeklyMenu(
      { ...pools, bigMeat: ["唯一大荤"] },
      undefined,
      seqRandom([0.5])
    );
    expect(new Set(flatten(plan, "bigMeat"))).toEqual(new Set(["唯一大荤"]));
  });

  it("跨多组随机种子都能产出合法菜单（覆盖排序各分支）", () => {
    const previous = makePlan({
      bigMeat: Array.from({ length: TOTAL_MEALS }, (_, i) =>
        i < 4 ? "大荤A" : "大荤B"
      ),
      smallMeat: Array.from({ length: TOTAL_MEALS }, () => "小荤A"),
      vegetable: Array.from({ length: TOTAL_MEALS }, (_, i) =>
        i % 2 === 0 ? "素A" : "素B"
      )
    });
    for (let seed = 0; seed < 12; seed += 1) {
      const random = seqRandom([
        (seed % 3) / 3,
        ((seed + 1) % 5) / 5,
        ((seed + 2) % 7) / 7,
        0.5
      ]);
      const plan = generateWeeklyMenu(pools, previous, random);
      expect(flatten(plan, "vegetable")).toHaveLength(TOTAL_MEALS);
    }
  });
});

describe("replaceDishInPlan", () => {
  it("替换指定槽位的菜，且换成池中另一道", () => {
    const plan = generateWeeklyMenu(pools, undefined, seqRandom([0.2, 0.5]));
    const before = plan[1]!.meals[0]!.bigMeat;
    const next = replaceDishInPlan(
      plan,
      1,
      0,
      "bigMeat",
      pools,
      undefined,
      seqRandom([0.9, 0.1])
    );
    const after = next[1]!.meals[0]!.bigMeat;
    expect(pools.bigMeat).toContain(after);
    expect(after).not.toBe(before);
    // 其余槽位不变
    expect(next[0]).toBe(plan[0]);
    expect(next[1]!.meals[1]).toBe(plan[1]!.meals[1]);
  });

  it("坐标越界时原样返回", () => {
    const plan = generateWeeklyMenu(pools, undefined, seqRandom([0.4]));
    expect(replaceDishInPlan(plan, 99, 0, "bigMeat", pools)).toBe(plan);
    expect(replaceDishInPlan(plan, 0, 99, "bigMeat", pools)).toBe(plan);
  });

  it("池中没有其它候选时原样返回", () => {
    const plan = generateWeeklyMenu(pools, undefined, seqRandom([0.4]));
    const current = plan[0]!.meals[0]!.bigMeat;
    const singlePool: DishPools = { ...pools, bigMeat: [current] };
    expect(replaceDishInPlan(plan, 0, 0, "bigMeat", singlePool)).toBe(plan);
  });

  it("替换时考虑上周历史", () => {
    const previous = makePlan({
      bigMeat: Array.from({ length: TOTAL_MEALS }, () => "大荤C"),
      smallMeat: Array.from({ length: TOTAL_MEALS }, () => "小荤A"),
      vegetable: Array.from({ length: TOTAL_MEALS }, () => "素A")
    });
    const plan = generateWeeklyMenu(pools, undefined, seqRandom([0.3, 0.7]));
    const next = replaceDishInPlan(
      plan,
      2,
      1,
      "bigMeat",
      pools,
      previous,
      seqRandom([0.5, 0.2, 0.8])
    );
    expect(pools.bigMeat).toContain(next[2]!.meals[1]!.bigMeat);
  });
});
