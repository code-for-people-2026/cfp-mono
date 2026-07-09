import { describe, expect, it } from "vitest";
import { groupByCategory } from "./groupByMainIngredient";
import type { Offering } from "@cfp/kith-inn-shared";

const offering = (name: string, category?: Offering["category"], mainIngredient?: string): Offering =>
  ({ id: name, name, kind: "component", category, mainIngredient, seller: 1 }) as Offering;

describe("groupByCategory", () => {
  it("groups offerings by category order", () => {
    const groups = groupByCategory([
      offering("青椒肉丝", "meat", "猪肉"),
      offering("番茄炒蛋", "veg", "鸡蛋"),
      offering("紫菜蛋花汤", "soup", "鸡蛋"),
      offering("红烧牛肉", "meat", "牛肉"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["荤", "素", "汤"]);
    expect(groups[0]?.offerings.map((o) => o.name)).toEqual(["青椒肉丝", "红烧牛肉"]);
    expect(groups[1]?.offerings.map((o) => o.name)).toEqual(["番茄炒蛋"]);
  });

  it("puts offerings without category under 未分类", () => {
    const groups = groupByCategory([offering("神秘菜"), offering("牛肉面", "staple", "牛肉")]);
    expect(groups.map((g) => g.label)).toEqual(["主食", "未分类"]);
  });

  it("returns an empty array for no offerings", () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
