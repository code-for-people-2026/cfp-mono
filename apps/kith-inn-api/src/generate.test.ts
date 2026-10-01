import { describe, expect, it } from "vitest";
import {
  CategorySchema, MenuPreviewSchema, type Category, type Dish, type GenerateInput, type Structure,
} from "@cfp/kith-inn-contracts";
import { generateMenu } from "./generate";

function settings(structure: Structure = { meat: 2, vegetable: 1, soup: 1 }, weekStart = "2026-09-21"): GenerateInput {
  return { structure, meals: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.parse(`${weekStart}T00:00:00Z`) + Math.floor(i / 2) * 86400000).toISOString().slice(0, 10),
    mealType: i % 2 === 0 ? "lunch" : "dinner", enabled: true,
  })) };
}

function pool(count = 30): Dish[] {
  return CategorySchema.options.flatMap((category, categoryIndex) => Array.from({ length: count }, (_, i) => ({
    id: `10000000-0000-4000-8000-${String(categoryIndex * 1000 + i).padStart(12, "0")}`,
    name: `${category}${i}`, category, active: true, version: 1,
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
  })));
}

describe("generateMenu pure preview", () => {
  it.each([0, 13])("avoids the saved neighbor at boundary slot %i without altering its snapshots", (target) => {
    const input = settings({ meat: 1, vegetable: 1, soup: 1 }), dishes = pool(2);
    input.meals.forEach((meal, i) => { meal.enabled = i === target; });
    const adjacent = generateMenu(target === 0 ? "2026-09-14" : "2026-09-28",
      settings(input.structure, target === 0 ? "2026-09-14" : "2026-09-28"), dishes, () => 0);
    // The nearest neighbor contains dish0 for each category, irrespective of randomness.
    for (const meal of adjacent.meals) for (const category of CategorySchema.options) {
      const dish = dishes.find((d) => d.category === category)!;
      meal[category] = [{ dishId: dish.id, name: dish.name }];
    }
    const before = structuredClone(adjacent);
    for (const random of [() => 0, () => 0.99]) {
      const result = generateMenu("2026-09-21", input, dishes, random, adjacent.meals);
      for (const category of CategorySchema.options) expect(result.meals[target]![category][0]!.name).toBe(`${category}1`);
    }
    expect(adjacent).toEqual(before);
  });

  it("balances both neighbors, ignores skipped meals/omitted soup, and permits unavoidable repeats", () => {
    const input = settings({ meat: 1, vegetable: 1, soup: 1 }), dishes = pool(3);
    input.meals.forEach((meal, i) => { meal.enabled = i === 0; });
    const neighbors = ["2026-09-14", "2026-09-28"].flatMap((week) =>
      generateMenu(week, settings(input.structure, week), dishes, () => 0).meals);
    neighbors.forEach((meal) => { meal.enabled = false; });
    for (const [at, number] of [[13, 0], [14, 1]] as const) {
      const meal = neighbors[at]!; meal.enabled = true;
      for (const category of CategorySchema.options) {
        const dish = dishes.filter((d) => d.category === category)[number]!;
        meal[category] = [{ dishId: dish.id, name: dish.name }];
      }
    }
    const result = generateMenu("2026-09-21", input, dishes, () => 0, neighbors);
    for (const category of CategorySchema.options) expect(result.meals[0]![category][0]!.name).toBe(`${category}2`);
    neighbors[13]!.soupOmitted = true;
    expect(generateMenu("2026-09-21", input, dishes, () => 0, neighbors).meals[0]!.soup[0]!.name).toBe("soup0");
    // Cross-meal repetition stays legal when the pool has only enough for one meal.
    const scarce = generateMenu("2026-09-21", settings({ meat: 2, vegetable: 2, soup: 2 }), pool(2), () => 0, neighbors);
    expect(MenuPreviewSchema.safeParse(scarce).success).toBe(true);
    for (const meal of scarce.meals) for (const category of CategorySchema.options) {
      expect(new Set(meal[category].map((dish) => dish.dishId)).size).toBe(2);
    }
  });

  it("fills fourteen ordered positions without any reuse when the pool is sufficient", () => {
    const preview = generateMenu("2026-09-21", settings(), pool(), () => 0.4);
    expect(MenuPreviewSchema.safeParse(preview).success).toBe(true);
    expect(preview.meals).toHaveLength(14);
    for (const category of CategorySchema.options) {
      const ids = preview.meals.flatMap((meal) => meal[category].map((dish) => dish.dishId));
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(preview).not.toHaveProperty("version");
    expect(preview).not.toHaveProperty("confirmedAt");
  });

  it.each(["2024-02-26", "2026-12-28", "2026-08-31"])("keeps calendar dates across the boundary starting %s", (weekStart) => {
    const input = settings(undefined, weekStart);
    const preview = generateMenu(weekStart, input, pool(), () => 0);
    expect(MenuPreviewSchema.safeParse(preview).success).toBe(true);
    expect(preview.meals.map((meal) => [meal.date, meal.mealType])).toEqual(input.meals.map((meal) => [meal.date, meal.mealType]));
  });

  it("leaves skipped positions empty without consuming candidates", () => {
    const input = settings();
    input.meals.forEach((meal, index) => { meal.enabled = index === 1 || index === 13; });
    const preview = generateMenu("2026-09-21", input, pool(), () => 0);
    for (const meal of preview.meals.filter((meal) => !meal.enabled)) {
      expect([meal.meat, meal.vegetable, meal.soup, meal.soupOmitted]).toEqual([[], [], [], false]);
    }
    expect(preview.meals[1]!.meat.map((dish) => dish.name)).toEqual(["meat0", "meat1"]);
    expect(preview.meals[13]!.meat.map((dish) => dish.name)).toEqual(["meat2", "meat3"]);
  });

  it("prefers unused then oldest dishes, spacing scarce-pool reuse without same-meal duplicates", () => {
    const preview = generateMenu("2026-09-21", settings(), pool(5), () => 0);
    expect(preview.meals.slice(0, 4).map((meal) => meal.meat.map((dish) => dish.name))).toEqual([
      ["meat0", "meat1"], ["meat2", "meat3"], ["meat4", "meat0"], ["meat1", "meat2"],
    ]);
    for (const category of CategorySchema.options) {
      const appearances = new Map<string, number[]>();
      preview.meals.forEach((meal, index) => {
        const ids = meal[category].map((dish) => dish.dishId);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => appearances.set(id, [...(appearances.get(id) ?? []), index]));
      });
      expect(appearances.size).toBe(5);
      if (category !== "meat") {
        const counts = [...appearances.values()].map((indices) => indices.length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      }
      for (const indices of appearances.values()) {
        indices.slice(1).forEach((index, i) => {
          expect(index - indices[i]!).toBeGreaterThanOrEqual(category === "meat" ? 2 : 5);
          expect(index - indices[i]!).toBeLessThanOrEqual(category === "meat" ? 3 : 5);
        });
      }
    }
  });

  it("handles all allowed structures, including zero categories and maximum counts", () => {
    for (let meat = 0; meat <= 10; meat++) for (let vegetable = 0; vegetable <= 10; vegetable++) {
      for (let soup = 0; soup <= 10; soup++) {
        if (meat + vegetable + soup < 1 || meat + vegetable + soup > 20) continue;
        const preview = generateMenu("2026-09-21", settings({ meat, vegetable, soup }), pool(10), () => 0.99);
        expect(MenuPreviewSchema.safeParse(preview).success).toBe(true);
      }
    }
  });

  it("reports every shortage before consuming randomness and ignores inactive dishes", () => {
    const dishes = pool(2);
    dishes.filter((dish) => dish.category !== "vegetable").forEach((dish) => { dish.active = false; });
    let randomCalls = 0;
    expect(() => generateMenu("2026-09-21", settings(), dishes, () => { randomCalls++; return 0; })).toThrowError(
      expect.objectContaining({ status: 422, code: "INSUFFICIENT_DISHES", details: { shortages: [
        { category: "meat", required: 2, available: 0 }, { category: "soup", required: 1, available: 0 },
      ] } }),
    );
    expect(randomCalls).toBe(0);
  });

  it("allows an entirely skipped week with an empty pool but still validates inputs and enabled meals", () => {
    const input = settings();
    input.meals.forEach((meal) => { meal.enabled = false; });
    const preview = generateMenu("2026-09-21", input, [], () => { throw Error("must not draw"); });
    expect(MenuPreviewSchema.safeParse(preview).success).toBe(true);
    expect(preview.meals).toEqual(input.meals.map((meal) => ({
      ...meal, soupOmitted: false, meat: [], vegetable: [], soup: [],
    })));
    expect(() => generateMenu("2026-09-22", input, [])).toThrowError(expect.objectContaining({ status: 400 }));
    expect(() => generateMenu("2026-09-21", { ...input, structure: { meat: 0, vegetable: 0, soup: 0 } }, []))
      .toThrowError(expect.objectContaining({ status: 400 }));
    input.meals[13]!.enabled = true;
    expect(() => generateMenu("2026-09-21", input, []))
      .toThrowError(expect.objectContaining({ status: 422, code: "INSUFFICIENT_DISHES" }));
  });

  it("uses the injected source deterministically and never mutates or aliases its inputs", () => {
    const input = settings(), dishes = pool();
    const before = structuredClone({ input, dishes });
    const first = generateMenu("2026-09-21", input, dishes, () => 0);
    expect(generateMenu("2026-09-21", input, dishes, () => 0)).toEqual(first);
    expect(generateMenu("2026-09-21", input, dishes, () => 0.99)).not.toEqual(first);
    first.structure.meat = 9;
    first.meals[0]!.meat[0]!.name = "修改预览";
    expect({ input, dishes }).toEqual(before);
  });

  it.each(["2026-09-22", "2026-09-28", "2026-02-30"])("rejects invalid or mismatched path %s", (weekStart) => {
    expect(() => generateMenu(weekStart, settings(), pool())).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it("rejects malformed settings and duplicate or malformed pool entries", () => {
    const input = settings();
    input.meals.pop();
    expect(() => generateMenu("2026-09-21", input, pool())).toThrowError(expect.objectContaining({ status: 400 }));
    const dishes = pool();
    expect(() => generateMenu("2026-09-21", settings(), [...dishes, dishes[0]!])).toThrowError(expect.objectContaining({ status: 400 }));
    dishes[0]!.category = "invalid" as Category;
    expect(() => generateMenu("2026-09-21", settings(), dishes)).toThrowError(expect.objectContaining({ status: 400 }));
  });

  it.each([NaN, Infinity, -0.1, 1])("rejects an invalid injected random sample %s", (sample) => {
    expect(() => generateMenu("2026-09-21", settings(), pool(), () => sample)).toThrow(RangeError);
  });
});
