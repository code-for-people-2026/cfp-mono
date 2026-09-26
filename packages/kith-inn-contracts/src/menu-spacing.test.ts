import { describe, expect, it } from "vitest";
import { adjacentWeekStarts, dishDistances, type MealSnapshot } from "./index";

describe("calendar spacing shared by generation and replacement", () => {
  it.each([
    ["2027-01-04", "2026-12-28", "2027-01-11"],
    ["2024-03-04", "2024-02-26", "2024-03-11"],
  ])("keeps neighbors and Sunday/Monday distance across %s", (monday, previous, next) => {
    expect(adjacentWeekStarts(monday!)).toEqual([previous, next]);
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const meal: MealSnapshot = { date: sunday, mealType: "dinner", enabled: true, soupOmitted: false,
      meat: [{ dishId: "ABC", name: "菜" }], vegetable: [], soup: [{ dishId: "s", name: "汤" }] };
    const target = { date: monday!, mealType: "lunch" as const, enabled: true };
    expect([...dishDistances(target, [meal])]).toEqual([["abc", 1], ["s", 1]]);
    expect([...dishDistances(target, [{ ...meal, soupOmitted: true }])]).toEqual([["abc", 1]]);
    expect(dishDistances(target, [{ ...meal, enabled: false }]).size).toBe(0);
    expect(dishDistances({ ...target, mealType: "dinner" }, [meal]).get("abc")).toBe(2);
  });
});
