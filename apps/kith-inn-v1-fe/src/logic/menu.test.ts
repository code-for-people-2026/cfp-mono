import { describe, expect, it } from "vitest";
import type { MealSlot } from "@cfp/kith-inn-v1-shared";
import {
  buildSingleTarget,
  buildMenuRange,
  buildWorkWeekTargets,
  generationErrorText,
  needsReplaceConfirmation,
  relaxedRulesText,
  replaceMealSlot
} from "./menu";
import { ApiError } from "../services/api";

const slot = (id: number, date: string): MealSlot => ({
  id,
  sellerId: 7,
  date,
  occasion: "lunch",
  menuItems: [
    { offeringId: 1, nameSnapshot: "荤一", mainIngredientSnapshot: "牛肉", categorySnapshot: "meat" },
    { offeringId: 2, nameSnapshot: "荤二", mainIngredientSnapshot: "猪肉", categorySnapshot: "meat" },
    { offeringId: 3, nameSnapshot: "素一", mainIngredientSnapshot: "青菜", categorySnapshot: "veg" },
    { offeringId: 4, nameSnapshot: "素二", mainIngredientSnapshot: null, categorySnapshot: "veg" },
    { offeringId: 5, nameSnapshot: "汤一", mainIngredientSnapshot: "番茄", categorySnapshot: "soup" }
  ],
  orderStatus: "draft",
  orderDeadline: null,
  priceCents: null,
  generatedAt: "2026-07-10T01:00:00.000Z"
});

describe("menu target view logic", () => {
  it("builds one target and five weekdays in stable lunch/dinner order", () => {
    expect(buildSingleTarget("2026-07-10", "dinner")).toEqual([{ date: "2026-07-10", occasion: "dinner" }]);
    expect(buildSingleTarget("bad", "lunch")).toEqual([]);
    expect(buildWorkWeekTargets("2026-07-10", ["lunch", "dinner"])).toEqual([
      { date: "2026-07-10", occasion: "lunch" },
      { date: "2026-07-10", occasion: "dinner" },
      { date: "2026-07-13", occasion: "lunch" },
      { date: "2026-07-13", occasion: "dinner" },
      { date: "2026-07-14", occasion: "lunch" },
      { date: "2026-07-14", occasion: "dinner" },
      { date: "2026-07-15", occasion: "lunch" },
      { date: "2026-07-15", occasion: "dinner" },
      { date: "2026-07-16", occasion: "lunch" },
      { date: "2026-07-16", occasion: "dinner" }
    ]);
    expect(buildWorkWeekTargets("not-a-date", ["lunch"])).toEqual([]);
    expect(buildWorkWeekTargets("2026-07-10", [])).toEqual([]);
    expect(buildMenuRange("2026-07-10")).toEqual({ from: "2026-07-10", to: "2026-08-09" });
    expect(buildMenuRange("bad")).toBeNull();
    for (const invalidDate of ["2026-13-01", "2026-02-30"]) {
      expect(buildSingleTarget(invalidDate, "lunch")).toEqual([]);
      expect(buildWorkWeekTargets(invalidDate, ["lunch"])).toEqual([]);
      expect(buildMenuRange(invalidDate)).toBeNull();
    }
  });

  it("recognizes existing-menu confirmation without treating other errors as conflicts", () => {
    expect(needsReplaceConfirmation({ code: "meal-slots-exist" })).toBe(true);
    expect(needsReplaceConfirmation({ code: "offering-pool-insufficient" })).toBe(false);
    expect(needsReplaceConfirmation(null)).toBe(false);
  });

  it("explains category counts when the offering pool is insufficient", () => {
    const error = new ApiError(422, "offering-pool-insufficient", "菜品池分类不足", {
      shortages: [
        null,
        "bad",
        { category: 1, required: 1, available: 0 },
        { category: "other", required: 1, available: 0 },
        { category: "soup", required: "1", available: 0 },
        { category: "soup", required: 1, available: "0" },
        { category: "meat", required: 2, available: 1 },
        { category: "soup", required: 1, available: 0 }
      ]
    });
    expect(generationErrorText(error)).toBe(
      "菜品池不足：荤菜缺 1 道（需 2，现有 1）、汤缺 1 道（需 1，现有 0）"
    );
    expect(generationErrorText(new ApiError(422, "offering-pool-insufficient", "原始提示")))
      .toBe("原始提示");
    expect(generationErrorText(new ApiError(422, "offering-pool-insufficient", "原始提示", null)))
      .toBe("原始提示");
    expect(generationErrorText(new ApiError(422, "offering-pool-insufficient", "原始提示", {})))
      .toBe("原始提示");
    expect(generationErrorText(new ApiError(422, "offering-pool-insufficient", "原始提示", { shortages: "bad" })))
      .toBe("原始提示");
    expect(generationErrorText(new ApiError(409, "meal-slots-exist", "已有菜单", {})))
      .toBe("已有菜单");
    expect(generationErrorText("bad")).toBe("菜单生成失败");
  });
});

describe("menu response view logic", () => {
  it("explains relaxed rules in fixed priority order", () => {
    expect(relaxedRulesText([
      "recent-main-ingredient",
      "same-week-offering",
      "same-day-main-ingredient"
    ])).toBe("已放宽：同周不重复菜、同日不重复主料、近 7 日不重复主料");
    expect(relaxedRulesText([])).toBe("");
  });

  it("replaces one slot in the current list and appends new slots", () => {
    const first = slot(1, "2026-07-10");
    const replacement = { ...first, generatedAt: "2026-07-10T02:00:00.000Z" };
    const second = slot(2, "2026-07-13");
    expect(replaceMealSlot([first], replacement)).toEqual([replacement]);
    expect(replaceMealSlot([first], second)).toEqual([first, second]);

    const lunch = slot(3, "2026-07-14");
    const dinner = { ...slot(4, "2026-07-14"), occasion: "dinner" as const };
    expect(replaceMealSlot([dinner], lunch)).toEqual([lunch, dinner]);
    expect(replaceMealSlot([lunch], dinner)).toEqual([lunch, dinner]);
  });
});
