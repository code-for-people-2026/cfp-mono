/**
 * 确定性选菜内核（PRD §6.2 — "她最头疼的一步"）。**纯函数、零 LLM**——LLM 只在润色层
 * （polish.ts）做菜名/文案，绝不参与"选哪道菜"的决策。从根上杜绝"推荐她不会做的菜"：
 * 只从池内选、满足去重/费工/频次约束，可被确定性单测 100% 覆盖。
 *
 * 约束：只选池内 component；最近 N 天主料不重复（"肉就那几样"）；单菜 N′ 天不重复；
 * 费工菜每顿 ≤ 阈值（"避免一天全是麻烦菜"）；频次加权（常做优先、冷门偶尔翻新）。
 * 池子太小填不满结构 → 返回 pool-too-small（PRD §6.2「可做的菜不够了，补几道？」）。
 */
import type { MealOccasion, MenuDish, MenuSlot, WeekMenu } from "@cfp/kith-inn-shared";
import type { Offering } from "@cfp/kith-inn-shared";

export type { MenuDish, MealOccasion };
/** Backwards-compat alias — core historically used `Slot`; shared calls it `MenuSlot`. */
export type Slot = MenuSlot;

export type MenuConstraints = {
  /** per-slot 荤素结构（默认 2 荤 2 素 1 汤 = 桃子"4 菜 1 汤"）。 */
  structure: { meat: number; veg: number; soup: number };
  /** 主料 N 天内不重复（默认 2——"不想跟昨天一样"）。 */
  mainIngredientWindowDays: number;
  /** 单菜 N 天内不重复（默认 3）。 */
  dishWindowDays: number;
  /** 每日费工菜上限（跨午+晚累计，默认 1——"避免一天全是麻烦菜"，PRD §6.2）。 */
  laboriousMaxPerDay: number;
  days: string[];
  meals: MealOccasion[];
};

export const DEFAULT_CONSTRAINTS: MenuConstraints = {
  structure: { meat: 2, veg: 2, soup: 1 },
  // "不想跟昨天一样" → 主料 1 天不重（昨天午+晚都不重）；N 可调（PRD §6.2）。
  mainIngredientWindowDays: 1,
  // 单菜 2 天内不重（更宽松——同一道菜隔两天可再做）。
  dishWindowDays: 2,
  laboriousMaxPerDay: 1,
  days: ["mon", "tue", "wed", "thu", "fri"],
  meals: ["lunch", "dinner"],
};

const LABORIOUS_TAG = "费工";

/** Backwards-compat alias — shared calls this `WeekMenu`. */
export type GenerateMenuResult = WeekMenu;

/** Map an Offering (payload) → the slim MenuDish the core selects on. */
export function toMenuDish(o: Offering): MenuDish {
  return {
    id: o.id,
    name: o.name,
    category: (o.category ?? "veg") as MenuDish["category"],
    mainIngredient: o.mainIngredient,
    tags: o.tags,
    useCount: o.useCount,
    lastUsedAt: o.lastUsedAt,
  };
}

/** Score comparator: 常做优先（useCount desc）→ 久未做优先（lastUsedAt asc，冷门翻新）→ id 稳定。 */
function compareDishes(a: MenuDish, b: MenuDish): number {
  const ua = a.useCount ?? 0;
  const ub = b.useCount ?? 0;
  if (ua !== ub) return ub - ua;
  const la = a.lastUsedAt ?? "";
  const lb = b.lastUsedAt ?? "";
  if (la !== lb) return la < lb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

type Lookback = { dishIds: Set<string>; mainIngredients: Set<string> };

/** Collect dish ids + 主料 from a set of slots (no slicing). */
function collectFrom(slots: Slot[]): Lookback {
  const dishIds = new Set<string>();
  const mainIngredients = new Set<string>();
  for (const s of slots) {
    for (const d of s.dishes) {
      dishIds.add(String(d.id));
      if (d.mainIngredient) mainIngredients.add(d.mainIngredient);
    }
  }
  return { dishIds, mainIngredients };
}

/** Build the no-repeat lookback from the most recent `k` slots' dishes (generation
 *  is backward-looking — picks avoid the last k slots). */
function lookbackFrom(slots: Slot[], k: number): Lookback {
  return collectFrom(slots.slice(-k));
}

type SlotFail = Extract<GenerateMenuResult, { ok: false }>;

/** Pick meat/veg for a slot: structure count + mainIngredient no-repeat + dish no-repeat + 费工 cap. */
function pickConstrained(
  pool: MenuDish[],
  cat: "meat" | "veg",
  count: number,
  dishLb: Lookback,
  miLb: Lookback,
  laborious: { count: number; max: number },
): { dishes: MenuDish[] } | { failed: { category: string; needed: number; available: number } } {
  const candidates = pool
    .filter((d) => d.category === cat)
    .filter((d) => !dishLb.dishIds.has(String(d.id)))
    .filter((d) => !d.mainIngredient || !miLb.mainIngredients.has(d.mainIngredient))
    .sort(compareDishes);
  const picked: MenuDish[] = [];
  for (const cand of candidates) {
    if (picked.length >= count) break;
    const isLaborious = (cand.tags ?? []).includes(LABORIOUS_TAG);
    if (isLaborious && laborious.count >= laborious.max) continue;
    picked.push(cand);
    if (isLaborious) laborious.count++;
  }
  return picked.length >= count ? { dishes: picked } : { failed: { category: cat, needed: count, available: picked.length } };
}

/** Pick soup for a slot: LRU rotation (oldest first) — few soup options, recurrence is
 *  unavoidable, so soup is exempt from the no-repeat windows (only fails if the pool
 *  has fewer soups than the structure needs). */
function pickSoup(pool: MenuDish[], count: number, dishLb: Lookback): { dishes: MenuDish[] } | { failed: { category: string; needed: number; available: number } } {
  const soups = pool
    .filter((d) => d.category === "soup")
    .sort((a, b) => {
      const la = a.lastUsedAt ?? "";
      const lb = b.lastUsedAt ?? "";
      if (la !== lb) return la < lb ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  // Prefer soups not in the dish lookback; fall back to LRU if all are recent.
  const fresh = soups.filter((d) => !dishLb.dishIds.has(String(d.id)));
  const chosen = (fresh.length >= count ? fresh : soups).slice(0, count);
  return chosen.length >= count ? { dishes: chosen } : { failed: { category: "soup", needed: count, available: chosen.length } };
}

/** Pick one slot's dishes: structure × category, honoring no-repeat (meat/veg) + LRU soup + 费工 cap.
 *  `laborious` is the DAY-level 费工 tracker (carried across the day's meals — PRD §6.2). */
function pickSlot(
  pool: MenuDish[],
  dishLb: Lookback,
  miLb: Lookback,
  c: MenuConstraints,
  slotLabel: string,
  laborious: { count: number; max: number },
): { dishes: MenuDish[] } | SlotFail {
  const picked: MenuDish[] = [];
  for (const [cat, count] of [["meat", c.structure.meat], ["veg", c.structure.veg]] as const) {
    if (count === 0) continue;
    const res = pickConstrained(pool, cat, count, dishLb, miLb, laborious);
    if ("dishes" in res) picked.push(...res.dishes);
    else return { ok: false, reason: "pool-too-small", missing: { ...res.failed, slot: slotLabel } };
  }
  if (c.structure.soup > 0) {
    const res = pickSoup(pool, c.structure.soup, dishLb);
    if ("dishes" in res) picked.push(...res.dishes);
    else return { ok: false, reason: "pool-too-small", missing: { ...res.failed, slot: slotLabel } };
  }
  return { dishes: picked };
}

/**
 * Generate a full week menu (Mon–Fri × lunch+dinner by default). Greedy + deterministic
 * (no randomness → reproducible + testable). Each slot honors the structure + the
 * no-repeat lookbacks; the lookback slides forward as slots fill. `history` seeds the
 * initial lookback (so a new week doesn't repeat last week's tail).
 */
export function generateWeekMenu(input: {
  pool: MenuDish[];
  constraints?: Partial<MenuConstraints>;
  history?: Slot[];
}): GenerateMenuResult {
  const c: MenuConstraints = {
    ...DEFAULT_CONSTRAINTS,
    ...input.constraints,
    structure: { ...DEFAULT_CONSTRAINTS.structure, ...(input.constraints?.structure ?? {}) },
  };
  const mealsPerDay = Math.max(1, c.meals.length);
  const dishLbSlots = c.dishWindowDays * mealsPerDay;
  const miLbSlots = c.mainIngredientWindowDays * mealsPerDay;

  const history = input.history ?? [];
  const menu: Slot[] = [];
  for (const day of c.days) {
    // 费工 cap is per-DAY (PRD §6.2) — carry the count across the day's meals.
    const laborious = { count: 0, max: c.laboriousMaxPerDay };
    for (const occasion of c.meals) {
      const label = `${day}-${occasion}`;
      const prior = [...history, ...menu];
      const res = pickSlot(
        input.pool,
        lookbackFrom(prior, dishLbSlots),
        lookbackFrom(prior, miLbSlots),
        c,
        label,
        laborious,
      );
      if ("dishes" in res) {
        menu.push({ day, occasion, dishes: res.dishes });
      } else {
        return res;
      }
    }
  }
  return { ok: true, menu };
}

export type SwapResult =
  | { ok: true; replacement: MenuDish }
  | { ok: false; reason: "slot-not-found" | "dish-not-in-slot" | "no-alternative" };

/**
 * 一键换菜：在满足约束的候选里替换某道菜（不让她自己想替代品）。同分类、未在 lookback、
 * 不已在槽内、且（费工时）不超费工阈值的候选里取分最高的。
 */
export function swapDish(input: {
  menu: Slot[];
  target: { day: string; occasion: MealOccasion };
  dishId: string | number;
  pool: MenuDish[];
  constraints?: Partial<MenuConstraints>;
}): SwapResult {
  const slot = input.menu.find((s) => s.day === input.target.day && s.occasion === input.target.occasion);
  if (!slot) return { ok: false, reason: "slot-not-found" };
  const target = slot.dishes.find((d) => String(d.id) === String(input.dishId));
  if (!target) return { ok: false, reason: "dish-not-in-slot" };

  const c: MenuConstraints = { ...DEFAULT_CONSTRAINTS, ...input.constraints };

  const inSlotIds = new Set(slot.dishes.map((d) => String(d.id)));
  // In-slot main-ingredient avoidance: a swap must not leave two dishes with the
  // same mainIngredient in one meal. Build the set from the REMAINING dishes
  // (excluding the one being swapped out — its mainIngredient is freed). The
  // cross-slot lookback was dropped in favor of compareDishes (useCount/lastUsedAt),
  // but this per-slot guard stays (Codex #128).
  const inSlotMI = new Set(
    slot.dishes.filter((d) => String(d.id) !== String(target.id) && d.mainIngredient).map((d) => d.mainIngredient),
  );
  // 费工 cap is per-DAY: count 费工 in the target's day, excluding the dish being swapped out.
  const dayLaborious = input.menu
    .filter((s) => s.day === slot.day)
    .flatMap((s) => s.dishes)
    .filter((d) => String(d.id) !== String(target.id) && (d.tags ?? []).includes(LABORIOUS_TAG))
    .length;
  const laboriousBudget = c.laboriousMaxPerDay - dayLaborious;

  const alt = input.pool
    .filter((d) => d.category === target.category && String(d.id) !== String(target.id))
    .filter((d) => !inSlotIds.has(String(d.id)))
    .filter((d) => !d.mainIngredient || !inSlotMI.has(d.mainIngredient))
    .filter((d) => !(d.tags ?? []).includes(LABORIOUS_TAG) || laboriousBudget > 0)
    .sort(compareDishes)[0];
  return alt ? { ok: true, replacement: alt } : { ok: false, reason: "no-alternative" };
}

export type SwapSpecifiedResult =
  | { ok: true; replacement: MenuDish; warning?: string }
  | { ok: false; reason: "slot-not-found" | "dish-not-in-slot" | "replacement-not-in-pool" | "replacement-same-as-target" };

/**
 * 指定换菜（US-M05「把牛腩换成香菇滑鸡」）——用户点名 replacement，系统只校验
 * （在池内、非同菜）+ 算主料避重 warning，不替用户选。warning 复用 `swapDish` 的
 * 邻槽 lookback（collectFrom）：replacement 的主料若与目标槽邻槽/同槽其它菜重复 → 提示。
 * 用户强制指定优先、但提示（PRD §6.2）。caller 收到 warning 后二次确认再应用。
 */
export function swapDishSpecified(input: {
  menu: Slot[];
  target: { day: string; occasion: MealOccasion };
  dishId: string | number;
  replacementId: string | number;
  pool: MenuDish[];
  constraints?: Partial<MenuConstraints>;
}): SwapSpecifiedResult {
  const c: MenuConstraints = { ...DEFAULT_CONSTRAINTS, ...input.constraints };
  const slot = input.menu.find((s) => s.day === input.target.day && s.occasion === input.target.occasion);
  if (!slot) return { ok: false, reason: "slot-not-found" };
  const target = slot.dishes.find((d) => String(d.id) === String(input.dishId));
  if (!target) return { ok: false, reason: "dish-not-in-slot" };
  const replacement = input.pool.find((d) => String(d.id) === String(input.replacementId));
  if (!replacement) return { ok: false, reason: "replacement-not-in-pool" };
  if (String(replacement.id) === String(target.id)) return { ok: false, reason: "replacement-same-as-target" };

  const idx = input.menu.indexOf(slot);
  const mealsPerDay = Math.max(1, c.meals.length);
  const miLbSlots = c.mainIngredientWindowDays * mealsPerDay;
  const neighborMi = collectFrom(input.menu.filter((_, i) => i !== idx && Math.abs(i - idx) <= miLbSlots)).mainIngredients;
  const inSlotOtherMi = new Set(
    slot.dishes.filter((d) => String(d.id) !== String(target.id) && d.mainIngredient).map((d) => d.mainIngredient),
  );
  const clash = !!replacement.mainIngredient && (neighborMi.has(replacement.mainIngredient) || inSlotOtherMi.has(replacement.mainIngredient));
  return clash ? { ok: true, replacement, warning: "会和近期主料重复，仍要换吗？" } : { ok: true, replacement };
}

/**
 * date-driven 生成（feature 003）：按任意 `targets: [{date, occasion}]` 列表生成，
 * 复用 `pickSlot` + lookback（主料/单菜避重、费工 per-date、汤 LRU）。与 `generateWeekMenu`
 * 的差别仅是输入从 `days×meals` 笛卡尔积改成显式 target 列表（支持"只发明天一餐"、
 * "排一周"、"重排某餐"）。`day` 字段填具体 date（标签用）。history 种子可选（M1 传 []）。
 */
export function generateForTargets(input: {
  targets: { date: string; occasion: MealOccasion }[];
  pool: MenuDish[];
  constraints?: Partial<MenuConstraints>;
  history?: Slot[];
}): GenerateMenuResult {
  const c: MenuConstraints = {
    ...DEFAULT_CONSTRAINTS,
    ...input.constraints,
    structure: { ...DEFAULT_CONSTRAINTS.structure, ...(input.constraints?.structure ?? {}) },
  };
  const mealsPerDay = Math.max(1, c.meals.length);
  const dishLbSlots = c.dishWindowDays * mealsPerDay;
  const miLbSlots = c.mainIngredientWindowDays * mealsPerDay;

  const history = input.history ?? [];
  const menu: Slot[] = [];
  const laboriousByDate = new Map<string, { count: number; max: number }>();
  for (const t of input.targets) {
    if (!laboriousByDate.has(t.date)) laboriousByDate.set(t.date, { count: 0, max: c.laboriousMaxPerDay });
    const laborious = laboriousByDate.get(t.date)!;
    const prior = [...history, ...menu];
    const res = pickSlot(
      input.pool,
      lookbackFrom(prior, dishLbSlots),
      lookbackFrom(prior, miLbSlots),
      c,
      `${t.date}-${t.occasion}`,
      laborious,
    );
    if ("dishes" in res) menu.push({ day: t.date, occasion: t.occasion, dishes: res.dishes });
    else return res;
  }
  return { ok: true, menu };
}
