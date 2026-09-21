import { describe, expect, it } from "vitest";
import { type Dish, type MenuPreview } from "@cfp/kith-inn-contracts";
import { randomReplaceDish, replaceDish, replacementCandidates, restoreSoup, setSoupOmitted, toWeekWriteInput } from "./week-editor";

const dish = (id: string, category: Dish["category"] = "meat", active = true): Dish => ({ id, category, active, name: id,
  version: 1, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z" });
const dishes = [dish("a"), dish("b"), dish("c"), dish("d", "meat", false), dish("v", "vegetable"), dish("s", "soup"), dish("t", "soup")];
const menu = (): MenuPreview => ({ weekStart: "2026-09-21", structure: { meat: 2, vegetable: 1, soup: 1 },
  meals: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${21 + Math.floor(i / 2)}`, mealType: i % 2 ? "dinner" : "lunch",
    enabled: true, soupOmitted: false, meat: [{ dishId: "a", name: "a" }, { dishId: "b", name: "b" }],
    vegetable: [{ dishId: "v", name: "v" }], soup: [{ dishId: "s", name: "原汤名" }] })) });

describe("week editing", () => {
  it("replaces exactly one position with a currently active same-category candidate", () => {
    const original = menu(), before = JSON.stringify(original);
    expect(replacementCandidates(original.meals[0]!, "meat", 0, dishes).map((d) => d.id)).toEqual(["c"]);
    const next = replaceDish(original, 0, "meat", 0, "c", dishes);
    expect(next.meals[0]!.meat).toEqual([{ dishId: "c", name: "c" }, { dishId: "b", name: "b" }]);
    expect(next.meals[1]).toBe(original.meals[1]);
    expect(next.meals[0]!.soup).toBe(original.meals[0]!.soup);
    expect(JSON.stringify(original)).toBe(before);
    for (const invalid of ["a", "b", "d", "v", "missing"]) expect(() => replaceDish(original, 0, "meat", 0, invalid, dishes)).toThrow();
    expect(randomReplaceDish(original, 0, "meat", 0, dishes, () => 0)).toEqual(next);
    expect(() => randomReplaceDish(original, 0, "meat", 0, dishes.slice(0, 2))).toThrow();
    expect(() => randomReplaceDish(original, 0, "meat", 0, dishes, () => 1)).toThrow();
    original.meals[0]!.enabled = false;
    expect(() => replaceDish(original, 0, "meat", 0, "c", dishes)).toThrow();
    expect(() => replaceDish(original, 14, "meat", 0, "c", dishes)).toThrow();
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
