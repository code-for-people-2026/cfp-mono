import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSTRAINTS,
  generateWeekMenu,
  swapDish,
  swapDishSpecified,
  toMenuDish,
  type MenuDish,
  type Slot,
} from "./core";

const meat = (n: number, mainIngredient: string, opts: Partial<MenuDish> = {}): MenuDish => ({
  id: `m${n}`,
  name: `肉${n}`,
  category: "meat",
  mainIngredient,
  tags: [],
  ...opts,
});
const veg = (n: number, mainIngredient: string, opts: Partial<MenuDish> = {}): MenuDish => ({
  id: `v${n}`,
  name: `素${n}`,
  category: "veg",
  mainIngredient,
  tags: [],
  ...opts,
});
const soup = (n: number, opts: Partial<MenuDish> = {}): MenuDish => ({
  id: `s${n}`,
  name: `汤${n}`,
  category: "soup",
  mainIngredient: `汤料${n}`,
  tags: [],
  ...opts,
});

/** A feasible pool for the default week (12 meat / 12 veg / 4 soup, distinct 主料).
 *  Sized so the no-repeat windows (主料 1 day, 单菜 2 days) don't exhaust a category. */
const feasMeats: MenuDish[] = ["牛", "鸡", "鱼", "猪", "鸭", "羊", "虾", "鹅", "兔", "驴", "鹿", "鸽"].map((mi, i) =>
  meat(i + 1, mi),
);
const feasVegs: MenuDish[] = ["青菜", "豆腐", "土豆", "茄子", "瓜", "豆角", "花菜", "菇", "笋", "木耳", "藕", "荷兰豆"].map((mi, i) =>
  veg(i + 1, mi),
);
const feasSoups: MenuDish[] = [soup(1), soup(2), soup(3), soup(4)];
const feasiblePool = [...feasMeats, ...feasVegs, ...feasSoups];

const meatMis = (slot: Slot): string[] => slot.dishes.filter((d) => d.category === "meat").map((d) => d.mainIngredient!);

describe("generateWeekMenu — happy path", () => {
  it("fills a full week (5 days × 2 meals = 10 slots)", () => {
    const r = generateWeekMenu({ pool: feasiblePool });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.menu).toHaveLength(10);
    expect(r.menu[0]).toMatchObject({ day: "mon", occasion: "lunch" });
    expect(r.menu[9]).toMatchObject({ day: "fri", occasion: "dinner" });
  });

  it("respects the 2荤2素1汤 structure in every slot", () => {
    const r = generateWeekMenu({ pool: feasiblePool });
    if (!r.ok) throw new Error("expected ok");
    for (const slot of r.menu) {
      const counts = { meat: 0, veg: 0, soup: 0 };
      for (const d of slot.dishes) counts[d.category as "meat"]++;
      expect(counts).toEqual({ meat: 2, veg: 2, soup: 1 });
    }
  });
});

describe("generateWeekMenu — no-repeat constraints", () => {
  it("主料 1 天内不重复 (slot's meat 主料 ∉ previous 2 slots)", () => {
    const r = generateWeekMenu({ pool: feasiblePool });
    if (!r.ok) throw new Error("expected ok");
    for (let i = 2; i < r.menu.length; i++) {
      const cur = new Set(meatMis(r.menu[i]!));
      const prev = new Set([...meatMis(r.menu[i - 1]!), ...meatMis(r.menu[i - 2]!)]);
      for (const mi of cur) expect(prev.has(mi)).toBe(false);
    }
  });

  it("单菜 2 天内不重复 (a meat/veg dish id ∉ previous 4 slots)", () => {
    const r = generateWeekMenu({ pool: feasiblePool });
    if (!r.ok) throw new Error("expected ok");
    const mvIds = (s: Slot) => s.dishes.filter((d) => d.category !== "soup").map((d) => String(d.id));
    for (let i = 4; i < r.menu.length; i++) {
      const cur = new Set(mvIds(r.menu[i]!));
      const prev = new Set([0, 1, 2, 3].flatMap((k) => mvIds(r.menu[i - 1 - k]!)));
      for (const id of cur) expect(prev.has(id)).toBe(false);
    }
  });

  it("费工菜每日 ≤ 1 (laboriousMaxPerDay, across lunch+dinner — Codex)", () => {
    // mark a few spread dishes 费工 (sparse, so non-费工 candidates stay plentiful)
    const laboriousIds = new Set(["m1", "m5", "v3"]);
    const pool = feasiblePool.map((d) => ({ ...d, tags: laboriousIds.has(String(d.id)) ? ["费工"] : d.tags ?? [] }));
    const r = generateWeekMenu({ pool });
    if (!r.ok) throw new Error("expected ok");
    // per-DAY: 费工 summed across the day's lunch+dinner ≤ cap (not per-slot).
    const byDay = new Map<string, number>();
    for (const slot of r.menu) {
      const n = slot.dishes.filter((d) => (d.tags ?? []).includes("费工")).length;
      byDay.set(slot.day, (byDay.get(slot.day) ?? 0) + n);
    }
    for (const n of byDay.values()) expect(n).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.laboriousMaxPerDay);
  });
});

describe("generateWeekMenu — frequency weighting", () => {
  it("prefers higher-useCount dishes when unconstrained (single slot)", () => {
    const pool: MenuDish[] = [
      meat(1, "牛", { useCount: 1 }),
      meat(2, "鸡", { useCount: 9 }),
      veg(1, "青菜", { useCount: 1 }),
      veg(2, "豆腐", { useCount: 9 }),
      soup(1, { useCount: 5 }),
    ];
    const r = generateWeekMenu({ pool, constraints: { days: ["mon"], meals: ["lunch"] } });
    if (!r.ok) throw new Error("expected ok");
    const ids = r.menu[0]!.dishes.map((d) => d.id);
    expect(ids).toContain("m2"); // high-useCount meat
    expect(ids).toContain("v2"); // high-useCount veg
  });
});

describe("generateWeekMenu — pool-too-small", () => {
  it("returns missing when a category can't fill the structure", () => {
    const pool: MenuDish[] = [meat(1, "牛"), ...feasVegs, ...feasSoups]; // only 1 meat, need 2
    const r = generateWeekMenu({ pool });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("pool-too-small");
    expect(r.missing).toMatchObject({ category: "meat", needed: 2, available: 1, slot: "mon-lunch" });
  });

  it("fails on soup shortage (structure wants soup but none)", () => {
    const pool: MenuDish[] = [...feasMeats, ...feasVegs]; // no soup
    const r = generateWeekMenu({ pool });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing.category).toBe("soup");
  });
});

describe("generateWeekMenu — soup LRU rotation", () => {
  it("rotates soups across slots (not the same soup twice in a row when alternatives exist)", () => {
    const r = generateWeekMenu({ pool: feasiblePool });
    if (!r.ok) throw new Error("expected ok");
    const soupIds = r.menu.map((s) => s.dishes.find((d) => d.category === "soup")!.id);
    // with 3 soups + dishWindow, consecutive slots shouldn't repeat
    expect(soupIds[0]).not.toBe(soupIds[1]);
  });
});

describe("generateWeekMenu — history", () => {
  it("seeds the lookback so the new week avoids history's tail 主料", () => {
    const history: Slot[] = [
      { day: "prev-mon", occasion: "lunch", dishes: [meat(1, "牛"), veg(1, "青菜"), soup(1)] },
      { day: "prev-mon", occasion: "dinner", dishes: [meat(2, "鸡"), veg(2, "豆腐"), soup(2)] },
    ];
    const r = generateWeekMenu({ pool: feasiblePool, history });
    if (!r.ok) throw new Error("expected ok");
    // mon-lunch is the first generated slot; its meat 主料 must avoid history's (last 2 slots)
    const monLunchMis = new Set(meatMis(r.menu[0]!));
    expect(monLunchMis.has("牛")).toBe(false);
    expect(monLunchMis.has("鸡")).toBe(false);
  });
});

describe("swapDish", () => {
  const menu = (): Slot[] => {
    const r = generateWeekMenu({ pool: feasiblePool });
    if (!r.ok) throw new Error("expected ok");
    return r.menu;
  };

  it("replaces a dish with a different one of the same category, not already in the slot", () => {
    const m = menu();
    const slot = m[0]!;
    const target = slot.dishes.find((d) => d.category === "meat")!;
    const res = swapDish({ menu: m, target: { day: slot.day, occasion: slot.occasion }, dishId: target.id, pool: feasiblePool });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.replacement.id).not.toBe(target.id);
    expect(res.replacement.category).toBe("meat");
    expect(slot.dishes.some((d) => d.id === res.replacement.id)).toBe(false);
  });

  it("returns slot-not-found for an unknown slot", () => {
    const res = swapDish({ menu: menu(), target: { day: "sat", occasion: "lunch" }, dishId: "m1", pool: feasiblePool });
    expect(res).toMatchObject({ ok: false, reason: "slot-not-found" });
  });

  it("returns dish-not-in-slot when the id isn't in the slot", () => {
    const m = menu();
    const res = swapDish({ menu: m, target: { day: m[0]!.day, occasion: m[0]!.occasion }, dishId: "m99", pool: feasiblePool });
    expect(res).toMatchObject({ ok: false, reason: "dish-not-in-slot" });
  });

  it("returns no-alternative when the pool is exhausted for the category", () => {
    const m = menu();
    const slot = m[0]!;
    const target = slot.dishes.find((d) => d.category === "meat")!;
    // tiny pool: only the target meat + nothing else eligible
    const res = swapDish({ menu: m, target: { day: slot.day, occasion: slot.occasion }, dishId: target.id, pool: [target] });
    expect(res).toMatchObject({ ok: false, reason: "no-alternative" });
  });
});

describe("toMenuDish", () => {
  it("maps an Offering to the slim MenuDish", () => {
    const d = toMenuDish({ id: 7, name: "红烧牛肉", kind: "component", category: "meat", mainIngredient: "牛肉", tags: ["费工"], seller: 1 } as never);
    expect(d).toMatchObject({ id: 7, name: "红烧牛肉", category: "meat", mainIngredient: "牛肉" });
  });
});

describe("swapDishSpecified", () => {
  const pool: MenuDish[] = [meat(1, "牛"), meat(2, "鸡"), meat(3, "鱼"), veg(1, "青菜"), veg(2, "番茄")];
  const menu: Slot[] = [
    { day: "mon", occasion: "lunch", dishes: [meat(1, "牛"), veg(1, "青菜")] },
    { day: "mon", occasion: "dinner", dishes: [meat(2, "鸡"), veg(2, "番茄")] },
  ];

  it("指定换成池内不冲突的菜 → ok 无 warning", () => {
    const r = swapDishSpecified({ menu, target: { day: "mon", occasion: "lunch" }, dishId: "v1", replacementId: "m3", pool });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.replacement.id).toBe("m3");
      expect(r.warning).toBeUndefined();
    }
  });

  it("主料与邻槽重复 → warning", () => {
    // lunch 的 v1 换成 m2(鸡)；dinner 已有 m2(鸡) → 鸡 邻槽重复
    const r = swapDishSpecified({ menu, target: { day: "mon", occasion: "lunch" }, dishId: "v1", replacementId: "m2", pool });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toBe("会和近期主料重复，仍要换吗？");
  });

  it("主料与同槽其它菜重复 → warning", () => {
    // lunch 的 v1 换成 m1(牛)；lunch 已有 m1(牛)
    const r = swapDishSpecified({ menu, target: { day: "mon", occasion: "lunch" }, dishId: "v1", replacementId: "m1", pool });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warning).toBe("会和近期主料重复，仍要换吗？");
  });

  it("replacement 不在池 → replacement-not-in-pool", () => {
    expect(swapDishSpecified({ menu, target: { day: "mon", occasion: "lunch" }, dishId: "v1", replacementId: "zzz", pool })).toEqual({
      ok: false,
      reason: "replacement-not-in-pool",
    });
  });

  it("replacement 与 target 同一道 → replacement-same-as-target", () => {
    expect(swapDishSpecified({ menu, target: { day: "mon", occasion: "lunch" }, dishId: "m1", replacementId: "m1", pool })).toEqual({
      ok: false,
      reason: "replacement-same-as-target",
    });
  });

  it("target slot 不存在 → slot-not-found", () => {
    expect(swapDishSpecified({ menu, target: { day: "wed", occasion: "lunch" }, dishId: "m1", replacementId: "m3", pool })).toEqual({
      ok: false,
      reason: "slot-not-found",
    });
  });

  it("dishId 不在该 slot → dish-not-in-slot", () => {
    expect(swapDishSpecified({ menu, target: { day: "mon", occasion: "lunch" }, dishId: "m2", replacementId: "m3", pool })).toEqual({
      ok: false,
      reason: "dish-not-in-slot",
    });
  });
});
