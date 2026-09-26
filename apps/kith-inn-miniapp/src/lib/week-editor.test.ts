import { describe, expect, it } from "vitest";
import { type Dish, type MenuPreview } from "@cfp/kith-inn-contracts";
import { recommendedReplacements, replaceDish, replacementCandidates, restoreSoup, setSoupOmitted, toWeekWriteInput } from "./week-editor";

const dish = (id: string, category: Dish["category"] = "meat", active = true): Dish => ({ id, category, active, name: id,
  version: 1, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z" });
const dishes = [dish("a"), dish("b"), dish("c"), dish("d", "meat", false), dish("v", "vegetable"), dish("s", "soup"), dish("t", "soup")];
const menu = (): MenuPreview => ({ weekStart: "2026-09-21", structure: { meat: 2, vegetable: 1, soup: 1 },
  meals: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${21 + Math.floor(i / 2)}`, mealType: i % 2 ? "dinner" : "lunch",
    enabled: true, soupOmitted: false, meat: [{ dishId: "a", name: "a" }, { dishId: "b", name: "b" }],
    vegetable: [{ dishId: "v", name: "v" }], soup: [{ dishId: "s", name: "原汤名" }] })) });

describe("week editing", () => {
  it.each([0, 13])("ranks against the saved neighbor for boundary slot %i, recomputing after changes", (target) => {
    const original = menu(), pool = [...dishes, dish("e")];
    const neighbor = { ...original.meals[0]!, date: target === 0 ? "2026-09-20" : "2026-09-28",
      mealType: target === 0 ? "dinner" as const : "lunch" as const, meat: [{ dishId: "C", name: "c" }] };
    const before = structuredClone({ original, neighbor });
    expect(recommendedReplacements(original, target, "meat", 0, pool, () => 0, [neighbor]).map((d) => d.id)).toEqual(["e", "c"]);
    expect({ original, neighbor }).toEqual(before);
    neighbor.meat = [{ dishId: "e", name: "e" }];
    expect(recommendedReplacements(original, target, "meat", 0, pool, () => 0, [neighbor]).map((d) => d.id)).toEqual(["c", "e"]);
    // If only one legal replacement exists it remains available, even when repeated next door.
    expect(recommendedReplacements(original, target, "meat", 0, dishes, () => 0, [{ ...neighbor, meat: [{ dishId: "c", name: "c" }] }]).map((d) => d.id)).toEqual(["c"]);
  });

  it("replaces exactly one position with a currently active same-category candidate", () => {
    const original = menu(), before = JSON.stringify(original);
    expect(replacementCandidates(original.meals[0]!, "meat", 0, dishes).map((d) => d.id)).toEqual(["c"]);
    const next = replaceDish(original, 0, "meat", 0, "c", dishes);
    expect(next.meals[0]!.meat).toEqual([{ dishId: "c", name: "c" }, { dishId: "b", name: "b" }]);
    expect(next.meals[1]).toBe(original.meals[1]);
    expect(next.meals[0]!.soup).toBe(original.meals[0]!.soup);
    expect(JSON.stringify(original)).toBe(before);
    for (const invalid of ["a", "b", "d", "v", "missing"]) expect(() => replaceDish(original, 0, "meat", 0, invalid, dishes)).toThrow();
    expect(recommendedReplacements(original, 0, "meat", 0, dishes, () => 0).map((d) => d.id)).toEqual(["c"]);
    expect(recommendedReplacements(original, 0, "meat", 0, dishes.slice(0, 2))).toEqual([]);
    for (const value of [NaN, Infinity, -0.1, 1]) expect(() => recommendedReplacements(original, 0, "meat", 0, dishes, () => value)).toThrow();
    original.meals[0]!.enabled = false;
    expect(() => replaceDish(original, 0, "meat", 0, "c", dishes)).toThrow();
    expect(() => replaceDish(original, 14, "meat", 0, "c", dishes)).toThrow();
  });
  it("ranks unused first, then the nearest occurrence on either side, without changing the menu or pool", () => {
    const original = menu(), pool = [...dishes, ...["far", "middle", "near", "future"].map((id) => dish(id))];
    const place = (at: number, id: string) => { original.meals[at]!.meat[0] = { dishId: id, name: id }; };
    place(0, "FAR"); place(3, "middle"); place(5, "near"); place(13, "near"); place(7, "future");
    const before = structuredClone({ original, pool });
    for (const random of [() => 0, () => 0.99]) {
      const result = recommendedReplacements(original, 6, "meat", 0, pool, random).map((d) => d.id);
      expect(result.slice(0, 3)).toEqual(["c", "far", "middle"]);
      expect(new Set(result.slice(3))).toEqual(new Set(["near", "future"]));
    }
    expect({ original, pool }).toEqual(before);
    // After accepting a recommendation, it counts in the current draft immediately.
    const changed = replaceDish(original, 4, "meat", 0, "c", pool);
    expect(recommendedReplacements(changed, 6, "meat", 0, pool, () => 0).map((d) => d.id).slice(0, 3)).toEqual(["far", "middle", "c"]);
  });
  it("randomizes equal recommendations without letting a nearby repeat outrank unused dishes", () => {
    const original = menu(), pool = [...dishes, dish("e"), dish("recent")];
    original.meals[1]!.meat[0] = { dishId: "recent", name: "recent" };
    const rank = (values: number[]) => recommendedReplacements(original, 0, "meat", 0, pool, () => values.shift()!).map((d) => d.id);
    expect(rank([0.9, 0.1, 0])).toEqual(["e", "c", "recent"]);
    expect(rank([0.1, 0.9, 0])).toEqual(["c", "e", "recent"]);
  });
  it("does not count omitted soups as served and ranks across skipped dates", () => {
    const original = menu(), pool = [...dishes, dish("u", "soup"), dish("z", "soup")];
    original.meals[5]!.soup = [{ dishId: "t", name: "t" }]; original.meals[5]!.soupOmitted = true;
    original.meals[0]!.soup = [{ dishId: "z", name: "z" }];
    original.meals[7]!.soup = [{ dishId: "u", name: "u" }];
    original.meals[3] = { ...original.meals[3]!, enabled: false, meat: [], vegetable: [], soup: [] };
    expect(recommendedReplacements(original, 6, "soup", 0, pool, () => 0).map((d) => d.id)).toEqual(["t", "z", "u"]);
    original.meals[5]!.soupOmitted = false;
    const result = recommendedReplacements(original, 6, "soup", 0, pool, () => 0).map((d) => d.id);
    expect(result[0]).toBe("z"); expect(new Set(result.slice(1))).toEqual(new Set(["t", "u"]));
  });
  it("omits and restores only this meal's complete soup, refreshing restored names", () => {
    const original = menu();
    const omitted = setSoupOmitted(original, 0, true, dishes);
    expect(original.meals[0]!.soupOmitted).toBe(false);
    expect(omitted.meals[0]!.soup).toBe(original.meals[0]!.soup);
    expect(setSoupOmitted(omitted, 0, false, dishes).meals[0]!.soup).toEqual([{ dishId: "s", name: "s" }]);
    const unavailable = dishes.filter((d) => d.id !== "s");
    expect(() => setSoupOmitted(omitted, 0, false, unavailable)).toThrow(expect.objectContaining({ code: "SOUP_RESELECTION_REQUIRED" }));
    expect(omitted.meals[0]!.soupOmitted).toBe(true);
    for (const ids of [[], ["v"], ["t", "t"], ["missing"]]) expect(() => restoreSoup(omitted, 0, ids, unavailable)).toThrow();
    const restored = restoreSoup(omitted, 0, ["t"], unavailable);
    expect(restored.meals[0]).toMatchObject({ soupOmitted: false, soup: [{ dishId: "t", name: "t" }] });
    expect(restored.meals.slice(1)).toEqual(original.meals.slice(1));
    expect(restored.structure).toBe(original.structure);
    const multiple = { ...omitted, structure: { ...omitted.structure, soup: 2 } };
    expect(() => restoreSoup(multiple, 0, ["t", "T"], dishes)).toThrow();
    expect(() => restoreSoup(multiple, 0, ["s", "t"], dishes.map((d) => d.id === "s" ? { ...d, active: false } : d))).toThrow();
    expect(restoreSoup(multiple, 0, ["s", "t"], dishes).meals[0]!.soup).toHaveLength(2);
  });
  it("serializes a detached ID-only write without trusting client snapshot names", () => {
    const original = menu(), input = toWeekWriteInput(original, 3, false, true);
    expect(input).toMatchObject({ baseVersion: 3, rebuild: false, confirm: true });
    expect(input.meals[0]!.soup).toEqual(["s"]);
    input.meals[0]!.soup[0] = "t"; input.structure.soup = 2;
    expect(original.meals[0]!.soup[0]!.dishId).toBe("s");
    expect(original.structure.soup).toBe(1);
  });
});
