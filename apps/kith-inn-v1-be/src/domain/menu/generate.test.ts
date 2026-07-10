import { describe, expect, it } from "vitest";
import type { MealSlot, MealSlotTarget, MenuItemSnapshot, Offering } from "@cfp/kith-inn-v1-shared";
import {
  generateMenus,
  OfferingPoolInsufficientError,
  swapMenuItem
} from "./generate";

const offering = (
  id: number,
  category: Offering["category"],
  name: string,
  mainIngredient: string | null,
  active = true
): Offering => ({ id, sellerId: 7, name, mainIngredient, category, active });

const baseOfferings = (soups: Offering[] = [offering(5, "soup", "番茄汤", "番茄")]): Offering[] => [
  offering(1, "meat", "牛肉", "牛肉"),
  offering(2, "meat", "猪肉", "猪肉"),
  offering(3, "veg", "青菜", "青菜"),
  offering(4, "veg", "豆腐", "豆腐"),
  ...soups
];

const snapshot = (
  offeringId: number,
  categorySnapshot: MenuItemSnapshot["categorySnapshot"],
  mainIngredientSnapshot: string | null
): MenuItemSnapshot => ({
  offeringId,
  nameSnapshot: `菜-${offeringId}`,
  mainIngredientSnapshot,
  categorySnapshot
});

const historySlot = (
  date: string,
  occasion: MealSlot["occasion"],
  soupId: number,
  soupMain: string | null
): MealSlot => ({
  id: `${date}-${occasion}`,
  sellerId: 7,
  date,
  occasion,
  menuItems: [
    snapshot(100, "meat", "历史荤一"),
    snapshot(101, "meat", "历史荤二"),
    snapshot(102, "veg", "历史素一"),
    snapshot(103, "veg", "历史素二"),
    snapshot(soupId, "soup", soupMain)
  ],
  orderStatus: "draft",
  priceCents: null,
  generatedAt: "2026-07-01T00:00:00.000Z"
});

describe("menu generator hard constraints", () => {
  it("uses only active offerings, produces 2/2/1 unique snapshots and does not mutate inputs", () => {
    const offerings = [offering(99, "soup", "停用汤", "停用", false), ...baseOfferings()];
    const before = structuredClone(offerings);
    const result = generateMenus({
      offerings,
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      history: [],
      random: () => 0
    });
    const items = result.menus[0]!.menuItems;
    expect(items.filter(({ categorySnapshot }) => categorySnapshot === "meat")).toHaveLength(2);
    expect(items.filter(({ categorySnapshot }) => categorySnapshot === "veg")).toHaveLength(2);
    expect(items.filter(({ categorySnapshot }) => categorySnapshot === "soup")).toHaveLength(1);
    expect(new Set(items.map(({ offeringId }) => offeringId)).size).toBe(5);
    expect(items).not.toContainEqual(expect.objectContaining({ offeringId: 99 }));
    expect(items[0]).toEqual({
      offeringId: expect.any(Number),
      nameSnapshot: expect.any(String),
      mainIngredientSnapshot: expect.anything(),
      categorySnapshot: expect.any(String)
    });
    expect(result.relaxedRules).toEqual([]);
    expect(offerings).toEqual(before);
  });

  it("reports every category shortage and returns no partial menu", () => {
    expect(() => generateMenus({
      offerings: [offering(1, "meat", "唯一荤菜", "肉")],
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      history: []
    })).toThrow(OfferingPoolInsufficientError);
    try {
      generateMenus({
        offerings: [offering(1, "meat", "唯一荤菜", "肉")],
        targets: [{ date: "2026-07-13", occasion: "lunch" }],
        history: []
      });
    } catch (error) {
      expect(error).toMatchObject({
        shortages: [
          { category: "meat", required: 2, available: 1 },
          { category: "veg", required: 2, available: 0 },
          { category: "soup", required: 1, available: 0 }
        ]
      });
    }
  });

  it("sorts targets and supports null ingredients with the default random source", () => {
    const result = generateMenus({
      offerings: baseOfferings([offering(5, "soup", "清汤", null)]),
      targets: [
        { date: "2026-07-14", occasion: "dinner" },
        { date: "2026-07-14", occasion: "lunch" },
        { date: "2026-07-13", occasion: "lunch" }
      ],
      history: []
    });
    expect(result.menus.map(({ target }) => `${target.date}:${target.occasion}`)).toEqual([
      "2026-07-13:lunch",
      "2026-07-14:lunch",
      "2026-07-14:dinner"
    ]);
    expect(result.menus[0]!.menuItems.find(({ categorySnapshot }) => categorySnapshot === "soup"))
      .toMatchObject({ mainIngredientSnapshot: null });
  });
});

describe("menu generator soft preference order", () => {
  const soupA = offering(5, "soup", "汤 A", "冬瓜");
  const soupB = offering(6, "soup", "汤 B", "番茄");
  const selectedSoup = (history: MealSlot[], target: MealSlotTarget = { date: "2026-07-13", occasion: "lunch" }) =>
    generateMenus({ offerings: baseOfferings([soupA, soupB]), targets: [target], history, random: () => 0 })
      .menus[0]!.menuItems.find(({ categorySnapshot }) => categorySnapshot === "soup")!;

  it("prioritizes same-week offering, then same-day main, then recent offering, then recent main", () => {
    expect(selectedSoup([
      historySlot("2026-07-14", "lunch", 5, "别的主料"),
      historySlot("2026-07-10", "lunch", 6, "番茄")
    ]).offeringId).toBe(6);

    expect(selectedSoup([
      historySlot("2026-07-13", "lunch", 99, "冬瓜"),
      historySlot("2026-07-12", "lunch", 6, "番茄")
    ], { date: "2026-07-13", occasion: "dinner" })).toMatchObject({ offeringId: 6 });

    expect(selectedSoup([
      historySlot("2026-07-12", "lunch", 5, "别的主料"),
      historySlot("2026-07-12", "dinner", 99, "番茄")
    ]).offeringId).toBe(6);
  });

  it("uses the injected random source only to break equal scores and explains relaxations", () => {
    expect(selectedSoup([]).offeringId).toBe(5);
    const tied = generateMenus({
      offerings: baseOfferings([soupA, soupB]),
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      history: [],
      random: () => 0.999
    });
    expect(tied.menus[0]!.menuItems.find(({ categorySnapshot }) => categorySnapshot === "soup")?.offeringId).toBe(6);

    const relaxed = generateMenus({
      offerings: baseOfferings([soupA]),
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      history: [historySlot("2026-07-12", "lunch", 5, "冬瓜")],
      random: () => 0
    });
    expect(relaxed.relaxedRules).toEqual(["recent-offering", "recent-main-ingredient"]);
  });
});

describe("menu item swap", () => {
  it("replaces only the selected item with an active same-category candidate", () => {
    const generated = generateMenus({
      offerings: baseOfferings(),
      targets: [{ date: "2026-07-13", occasion: "lunch" }],
      history: [],
      random: () => 0
    }).menus[0]!;
    const slot: MealSlot = {
      id: 11,
      sellerId: 7,
      ...generated.target,
      menuItems: generated.menuItems,
      orderStatus: "draft",
      priceCents: null,
      generatedAt: "2026-07-10T00:00:00.000Z"
    };
    const before = structuredClone(slot);
    expect(swapMenuItem({ slot, offeringId: 999, offerings: baseOfferings(), history: [] })).toBeNull();
    expect(swapMenuItem({
      slot,
      offeringId: 5,
      offerings: [...baseOfferings(), offering(6, "soup", "新汤", "海带", false)],
      history: []
    })).toBeNull();
    expect(slot).toEqual(before);

    const swapped = swapMenuItem({
      slot,
      offeringId: 5,
      offerings: [...baseOfferings(), offering(6, "soup", "新汤", "海带")],
      history: [slot],
      random: () => 0
    });
    expect(swapped?.menuItems.filter(({ offeringId }) => offeringId !== 5)).toHaveLength(5);
    expect(swapped?.menuItems).toContainEqual({
      offeringId: 6,
      nameSnapshot: "新汤",
      mainIngredientSnapshot: "海带",
      categorySnapshot: "soup"
    });
    expect(swapped?.menuItems.filter((item, index) => item.offeringId !== before.menuItems[index]!.offeringId)).toHaveLength(1);
  });
});
