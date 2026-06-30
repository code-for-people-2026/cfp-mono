import { describe, expect, it } from "vitest";
import { dayLabel, dishChips, formatWeekRange, occasionLabel, type MenuDish } from "./menuView";

describe("dayLabel", () => {
  it("maps mon–sun to 周X", () => {
    expect(dayLabel("mon")).toBe("周一");
    expect(dayLabel("fri")).toBe("周五");
    expect(dayLabel("sun")).toBe("周日");
  });

  it("passes unknown keys through", () => {
    expect(dayLabel("zzz")).toBe("zzz");
  });
});

describe("occasionLabel", () => {
  it("labels lunch/dinner", () => {
    expect(occasionLabel("lunch")).toBe("午餐");
    expect(occasionLabel("dinner")).toBe("晚餐");
  });
});

describe("dishChips", () => {
  it("orders main ingredient → tags with the right tones", () => {
    const dish: MenuDish = { id: 1, name: "番茄土豆炖牛腩", category: "meat", mainIngredient: "牛肉", tags: ["费工"] };
    expect(dishChips(dish)).toEqual([
      { label: "牛肉", tone: "red" },
      { label: "费工", tone: "amber" },
    ]);
  });

  it("marks the soup category as a blue 汤 chip", () => {
    expect(dishChips({ id: 2, name: "冬瓜丸子汤", category: "soup" })).toEqual([{ label: "汤", tone: "blue" }]);
  });

  it("清淡 → green, unknown tag → green, no main ingredient → no red chip", () => {
    expect(dishChips({ id: 3, name: "清炒时蔬", category: "veg", tags: ["清淡", "家常"] })).toEqual([
      { label: "清淡", tone: "green" },
      { label: "家常", tone: "green" },
    ]);
  });

  it("returns no chips when there is nothing to show", () => {
    expect(dishChips({ id: 4, name: "米饭", category: "staple" })).toEqual([]);
  });
});

describe("formatWeekRange", () => {
  it("returns M/D-M/D for the Mon–Fri week containing the date (Tue)", () => {
    expect(formatWeekRange(new Date(2026, 5, 30))).toBe("6/29-7/3");
  });

  it("handles a Monday (week start)", () => {
    expect(formatWeekRange(new Date(2026, 5, 29))).toBe("6/29-7/3");
  });

  it("handles a Sunday (rolls back to the prior Monday)", () => {
    expect(formatWeekRange(new Date(2026, 6, 5))).toBe("6/29-7/3");
  });
});
