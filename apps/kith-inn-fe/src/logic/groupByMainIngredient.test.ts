import { describe, expect, it } from "vitest";
import { groupByMainIngredient } from "./groupByMainIngredient";
import type { Offering } from "@cfp/kith-inn-shared";

const offering = (name: string, mainIngredient?: string): Offering =>
  ({ id: name, name, kind: "component", mainIngredient, seller: 1 }) as Offering;

describe("groupByMainIngredient", () => {
  it("groups offerings by their mainIngredient", () => {
    const groups = groupByMainIngredient([
      offering("番茄炒蛋", "鸡蛋"),
      offering("紫菜蛋花汤", "鸡蛋"),
      offering("红烧牛肉", "牛肉"),
    ]);
    expect(groups).toHaveLength(2);
    const eggs = groups.find((g) => g.mainIngredient === "鸡蛋");
    expect(eggs?.offerings.map((o) => o.name)).toEqual(["番茄炒蛋", "紫菜蛋花汤"]);
  });

  it("puts offerings without a mainIngredient under '其他'", () => {
    const groups = groupByMainIngredient([offering("神秘菜"), offering("牛肉面", "牛肉")]);
    expect(groups.find((g) => g.mainIngredient === "其他")?.offerings).toHaveLength(1);
  });

  it("returns an empty array for no offerings", () => {
    expect(groupByMainIngredient([])).toEqual([]);
  });
});
