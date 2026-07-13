import { describe, expect, it, vi } from "vitest";
import {
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
  const old = meat(90, "猪");
  const target = { day: "2026-07-08", occasion: "lunch" as const };
  const slot = (dishes: MenuDish[] = [old, veg(1, "青菜")]): Slot => ({ ...target, dishes });
  const historySlot = (day: string, dishes: MenuDish[]): Slot => ({ day, occasion: "dinner", dishes });
  const run = (pool: MenuDish[], history: Slot[] = [], extra: { dishIndex?: number; random?: () => number } = {}) =>
    swapDish({ menu: [slot()], target, dishId: old.id, pool, history, ...extra });

  it("selects a zero-conflict candidate from an ample pool", () => {
    const clean = meat(1, "鱼");
    const clashing = meat(2, "牛");
    const res = run([clashing, clean], [historySlot(target.day, [veg(8, "牛")])]);
    expect(res).toEqual({ ok: true, replacement: clean, targetIndex: 0, relaxedRules: [] });
  });

  it("still selects the only eligible candidate and explains a remaining-meal conflict", () => {
    const only = meat(1, "牛");
    const current = slot([old, veg(8, "牛")]);
    expect(swapDish({ menu: [current], target, dishId: old.id, pool: [only] })).toEqual({
      ok: true,
      replacement: only,
      targetIndex: 0,
      relaxedRules: ["same-day-main-ingredient"],
    });
  });

  it("returns errors only for a missing slot, target or eligible alternative", () => {
    expect(swapDish({ menu: [slot()], target: { ...target, day: "2026-07-09" }, dishId: old.id, pool: [meat(1, "鱼")] })).toMatchObject({ ok: false, reason: "slot-not-found" });
    expect(swapDish({ menu: [slot()], target, dishId: "missing", pool: [meat(1, "鱼")] })).toMatchObject({ ok: false, reason: "dish-not-in-slot" });
    expect(run([old, veg(2, "土豆")])).toMatchObject({ ok: false, reason: "no-alternative" });
  });

  it("compares all four conflict counts lexicographically", () => {
    const a = meat(1, "鱼");
    const b = meat(2, "鸡");
    const random = vi.fn(() => 0.5);
    expect(run([a, b], [historySlot(target.day, [veg(3, "鱼")]), historySlot("2026-07-09", [b])], { random })).toMatchObject({ ok: true, replacement: a });
    expect(random).not.toHaveBeenCalled();
    expect(run([a, b], [historySlot("2026-07-05", [a]), historySlot(target.day, [veg(3, "鸡")])])).toMatchObject({ ok: true, replacement: a });
    expect(run([a, b], [historySlot("2026-07-05", [veg(3, "鱼"), b])])).toMatchObject({ ok: true, replacement: a });
    expect(run([a, b], [historySlot("2026-07-05", [veg(3, "鱼"), veg(4, "鸡"), soup(8, { mainIngredient: "鸡" })])])).toMatchObject({ ok: true, replacement: a });
  });

  it("uses calendar days and Monday-Sunday natural weeks across boundaries", () => {
    const only = meat(1, "鱼");
    const rulesFor = (day: string) => {
      const res = run([only], [historySlot(day, [only])]);
      if (!res.ok) throw new Error("expected swap");
      return res.relaxedRules;
    };
    expect(rulesFor("2026-07-01")).toEqual(["recent-offering", "recent-main-ingredient"]); // -7 days
    expect(rulesFor("2026-06-30")).toEqual([]); // -8 days
    expect(rulesFor("2026-07-08")).toEqual(["same-week-offering", "same-day-main-ingredient"]);
    expect(rulesFor("2026-07-09")).toEqual(["same-week-offering"]); // future is not recent

    const noMain: MenuDish = { id: "plain", name: "无主料菜", category: "meat" };
    const noMainResult = run([noMain], [historySlot("2026-07-01", [noMain])]);
    expect(noMainResult).toMatchObject({ ok: true, relaxedRules: ["recent-offering"] });

    const yearTarget = { day: "2027-01-01", occasion: "lunch" as const };
    const res = swapDish({ menu: [{ ...yearTarget, dishes: [old] }], target: yearTarget, dishId: old.id, pool: [only], history: [historySlot("2026-12-28", [only])] });
    expect(res).toMatchObject({ ok: true, relaxedRules: ["same-week-offering", "recent-offering", "recent-main-ingredient"] });
  });

  it("uses injected randomness only to resolve ties and clamps boundary values", () => {
    const first = meat(1, "鱼");
    const last = meat(2, "鸡");
    const low = vi.fn(() => 0);
    const high = vi.fn(() => 1);
    expect(run([first, last], [], { random: low })).toMatchObject({ ok: true, replacement: first });
    expect(run([first, last], [], { random: high })).toMatchObject({ ok: true, replacement: last });
    expect(low).toHaveBeenCalledOnce();
    expect(high).toHaveBeenCalledOnce();
  });

  it("resolves duplicate targets by explicit index or the first match without mutating other positions", () => {
    const duplicate = { ...old };
    const keeper = veg(2, "土豆");
    const current = slot([old, keeper, duplicate]);
    const replacement = meat(1, "鱼");
    const implicit = swapDish({ menu: [current], target, dishId: old.id, pool: [replacement] });
    const explicit = swapDish({ menu: [current], target, dishId: old.id, dishIndex: 2, pool: [replacement] });
    expect(implicit).toMatchObject({ ok: true, targetIndex: 0 });
    expect(explicit).toMatchObject({ ok: true, targetIndex: 2 });
    expect(swapDish({ menu: [current], target, dishId: old.id, dishIndex: 1, pool: [replacement] })).toMatchObject({ ok: false, reason: "dish-not-in-slot" });
    if (!explicit.ok) throw new Error("expected swap");
    const next = [...current.dishes];
    next[explicit.targetIndex] = explicit.replacement;
    expect(next).toEqual([old, keeper, replacement]);
    expect(current.dishes).toEqual([old, keeper, duplicate]);
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

  it("重复 dish 可指定目标位置，省略时默认首项", () => {
    const duplicateMenu: Slot[] = [{ day: "2026-07-08", occasion: "lunch", dishes: [meat(1, "牛"), veg(1, "青菜"), meat(1, "牛")] }];
    const input = { menu: duplicateMenu, target: { day: "2026-07-08", occasion: "lunch" as const }, dishId: "m1", replacementId: "m3", pool };
    expect(swapDishSpecified(input)).toMatchObject({ ok: true, targetIndex: 0 });
    expect(swapDishSpecified({ ...input, dishIndex: 2 })).toMatchObject({ ok: true, targetIndex: 2 });
    expect(swapDishSpecified({ ...input, dishIndex: 1 })).toMatchObject({ ok: false, reason: "dish-not-in-slot" });
  });

  it("显式历史只在既有主料窗口内触发 warning", () => {
    const datedMenu: Slot[] = [{ day: "2026-07-08", occasion: "lunch", dishes: [meat(1, "牛"), veg(1, "青菜")] }];
    const input = { menu: datedMenu, target: { day: "2026-07-08", occasion: "lunch" as const }, dishId: "v1", replacementId: "m2", pool };
    expect(swapDishSpecified({ ...input, history: [{ day: "2026-07-07", occasion: "dinner", dishes: [meat(8, "鸡")] }] })).toMatchObject({ ok: true, warning: "会和近期主料重复，仍要换吗？" });
    expect(swapDishSpecified({ ...input, history: [{ day: "2026-07-06", occasion: "dinner", dishes: [meat(8, "鸡")] }] })).not.toHaveProperty("warning");
  });
});
