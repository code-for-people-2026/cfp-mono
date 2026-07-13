import { describe, expect, it, vi } from "vitest";
import {
  generateWeekMenu,
  scoreSwapCandidate,
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
  ...opts,
});
const veg = (n: number, mainIngredient: string, opts: Partial<MenuDish> = {}): MenuDish => ({
  id: `v${n}`,
  name: `素${n}`,
  category: "veg",
  mainIngredient,
  ...opts,
});
const soup = (n: number, opts: Partial<MenuDish> = {}): MenuDish => ({
  id: `s${n}`,
  name: `汤${n}`,
  category: "soup",
  mainIngredient: `汤料${n}`,
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

  it("shrinks no-repeat windows when the pool is below the full-window minimum", () => {
    const pool: MenuDish[] = [
      meat(1, "牛"),
      meat(2, "鸡"),
      meat(3, "鱼"),
      meat(4, "猪"),
      veg(1, "青菜"),
      veg(2, "豆腐"),
      veg(3, "茄子"),
      veg(4, "土豆"),
      soup(1),
    ];
    const r = generateWeekMenu({ pool, constraints: { days: ["mon", "tue"], meals: ["lunch", "dinner"] } });
    if (!r.ok) throw new Error("expected ok");

    const ids = (slot: Slot, category: "meat" | "veg") => slot.dishes.filter((d) => d.category === category).map((d) => String(d.id));
    for (let i = 1; i < r.menu.length; i++) {
      for (const category of ["meat", "veg"] as const) {
        const prev = new Set(ids(r.menu[i - 1]!, category));
        expect(ids(r.menu[i]!, category).some((id) => prev.has(id))).toBe(false);
      }
    }
  });

  it("randomly samples from valid candidates", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const pool: MenuDish[] = [
      meat(1, "牛"),
      meat(2, "鸡"),
      meat(3, "鱼"),
      veg(1, "青菜"),
      veg(2, "豆腐"),
      veg(3, "茄子"),
      soup(1),
      soup(2),
    ];
    try {
      const r = generateWeekMenu({ pool, constraints: { days: ["mon"], meals: ["lunch"] } });
      if (!r.ok) throw new Error("expected ok");
      expect(r.menu[0]!.dishes.map((d) => d.id)).toEqual(["m3", "m2", "v3", "v2", "s2"]);
    } finally {
      random.mockRestore();
    }
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

describe("generateWeekMenu — soup rotation", () => {
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

  it("prefers a dish whose mainIngredient is not used by a remaining slot mate (#128)", () => {
    // 同餐主料重复从硬过滤改为第二级偏好；无冲突候选仍应胜出。
    const keeper = meat(1, "牛");
    const target = meat(2, "猪");
    const slot: Slot = { day: "mon", occasion: "lunch", dishes: [target, keeper, veg(1, "菜")] };
    const sameMiCandidate = meat(3, "牛");
    const otherMiCandidate = meat(4, "鱼");
    const res = swapDish({
      menu: [slot],
      target: { day: "mon", occasion: "lunch" },
      dishId: target.id,
      pool: [sameMiCandidate, otherMiCandidate],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.replacement.mainIngredient).not.toBe("牛"); // 无冲突候选的第二级分数更低
    expect(res.replacement.id).toBe(otherMiCandidate.id);
  });

  it("allows the only eligible candidate and explains the relaxed same-day rule", () => {
    const target = meat(1, "猪");
    const keeper = meat(2, "牛");
    const candidate = meat(3, "牛");
    const slot: Slot = { day: "2026-07-13", occasion: "lunch", dishes: [target, keeper] };
    const before = [...slot.dishes];
    const random = vi.fn(() => 0);

    const res = swapDish({
      menu: [slot],
      target: { day: slot.day, occasion: slot.occasion },
      dishId: target.id,
      pool: [candidate],
      random,
    });

    expect(res).toEqual({
      ok: true,
      replacement: candidate,
      targetIndex: 0,
      relaxedRules: ["same-day-main-ingredient"],
    });
    expect(slot.dishes).toEqual(before);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "same-week offering before lower-level conflicts",
      history: (preferred: MenuDish, rejected: MenuDish): Slot[] => [
        { day: "2026-07-14", occasion: "lunch", dishes: [rejected] },
        { day: "2026-07-13", occasion: "dinner", dishes: [meat(90, preferred.mainIngredient!)] },
        { day: "2026-07-12", occasion: "lunch", dishes: [preferred] },
      ],
    },
    {
      name: "same-day main before recent offering and main",
      history: (preferred: MenuDish, rejected: MenuDish): Slot[] => [
        { day: "2026-07-13", occasion: "dinner", dishes: [meat(90, rejected.mainIngredient!)] },
        { day: "2026-07-12", occasion: "lunch", dishes: [preferred] },
      ],
    },
    {
      name: "recent offering before recent main",
      history: (preferred: MenuDish, rejected: MenuDish): Slot[] => [
        { day: "2026-07-12", occasion: "lunch", dishes: [rejected, meat(90, preferred.mainIngredient!)] },
      ],
    },
    {
      name: "recent main as the final tie-break level",
      history: (_preferred: MenuDish, rejected: MenuDish): Slot[] => [
        { day: "2026-07-12", occasion: "lunch", dishes: [meat(90, rejected.mainIngredient!)] },
      ],
    },
  ])("uses $name", ({ history }) => {
    const target = meat(1, "猪");
    const preferred = meat(2, "鸡");
    const rejected = meat(3, "牛");
    const random = vi.fn(() => 0);
    const res = swapDish({
      menu: [{ day: "2026-07-13", occasion: "lunch", dishes: [target] }],
      target: { day: "2026-07-13", occasion: "lunch" },
      dishId: target.id,
      pool: [rejected, preferred],
      history: history(preferred, rejected),
      random,
    });
    expect(res.ok && res.replacement.id).toBe(preferred.id);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([
    { sample: -1, expected: "m2" },
    { sample: 0, expected: "m2" },
    { sample: 0.999, expected: "m3" },
    { sample: 1, expected: "m3" },
  ])("clamps tied-candidate random sample $sample", ({ sample, expected }) => {
    const random = vi.fn(() => sample);
    const res = swapDish({
      menu: [{ day: "2026-07-13", occasion: "lunch", dishes: [meat(1, "猪")] }],
      target: { day: "2026-07-13", occasion: "lunch" },
      dishId: "m1",
      pool: [meat(2, "鸡"), meat(3, "牛")],
      random,
    });
    expect(res.ok && res.replacement.id).toBe(expected);
    expect(random).toHaveBeenCalledOnce();
  });

  it("uses dishIndex for duplicate ids and defaults to the first occurrence", () => {
    const duplicate = meat(1, "猪");
    const candidate = meat(3, "猪");
    const slot: Slot = { day: "2026-07-13", occasion: "lunch", dishes: [duplicate, veg(1, "菜"), duplicate] };
    const base = { menu: [slot], target: { day: slot.day, occasion: slot.occasion }, dishId: duplicate.id, pool: [candidate] };

    expect(swapDish({ ...base, dishIndex: 2 })).toMatchObject({ ok: true, targetIndex: 2 });
    expect(swapDish(base)).toMatchObject({ ok: true, targetIndex: 0 });
    expect(swapDish({ ...base, dishIndex: 1 })).toEqual({ ok: false, reason: "dish-not-in-slot" });
  });
});

describe("scoreSwapCandidate", () => {
  it("counts natural-week, same-day, 1-day and 7-day boundaries but excludes day 8", () => {
    const candidate = meat(9, "鸡");
    const history: Slot[] = [
      { day: "2026-07-14", occasion: "lunch", dishes: [candidate] },
      { day: "2026-07-13", occasion: "dinner", dishes: [meat(90, "鸡")] },
      { day: "2026-07-12", occasion: "lunch", dishes: [candidate] },
      { day: "2026-07-06", occasion: "lunch", dishes: [candidate] },
      { day: "2026-07-05", occasion: "lunch", dishes: [candidate] },
    ];
    expect(scoreSwapCandidate({ candidate, targetDate: "2026-07-13", history, remaining: [meat(91, "鸡")] })).toEqual([1, 2, 2, 2]);
  });

  it("treats a Monday in December and Thursday in January as the same natural week", () => {
    const candidate = meat(9, "鸡");
    const history: Slot[] = [{ day: "2025-12-29", occasion: "lunch", dishes: [candidate] }];
    expect(scoreSwapCandidate({ candidate, targetDate: "2026-01-01", history, remaining: [] })).toEqual([1, 0, 1, 1]);
  });
});

describe("toMenuDish", () => {
  it("maps an Offering to the slim MenuDish", () => {
    const d = toMenuDish({ id: 7, name: "红烧牛肉", kind: "component", category: "meat", mainIngredient: "牛肉", seller: 1 } as never);
    expect(d).toEqual({ id: 7, name: "红烧牛肉", category: "meat", mainIngredient: "牛肉" });
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

  it("重复 dishId 时按显式位置解析并返回 targetIndex", () => {
    const duplicate = meat(1, "牛");
    const repeatedMenu: Slot[] = [{ day: "mon", occasion: "lunch", dishes: [duplicate, veg(1, "青菜"), duplicate] }];
    expect(swapDishSpecified({
      menu: repeatedMenu,
      target: { day: "mon", occasion: "lunch" },
      dishId: duplicate.id,
      dishIndex: 2,
      replacementId: "m3",
      pool,
    })).toMatchObject({ ok: true, targetIndex: 2 });
    expect(swapDishSpecified({
      menu: repeatedMenu,
      target: { day: "mon", occasion: "lunch" },
      dishId: duplicate.id,
      dishIndex: 1,
      replacementId: "m3",
      pool,
    })).toEqual({ ok: false, reason: "dish-not-in-slot" });
  });
});
