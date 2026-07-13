/**
 * 选菜内核（PRD §6.2 — "她最头疼的一步"）。**零 LLM**——LLM 只在润色层
 * （polish.ts）做菜名/文案，绝不参与"选哪道菜"的决策。从根上杜绝"推荐她不会做的菜"：
 * 只从池内选、满足去重约束。
 *
 * 约束：只选池内 component；最近 N 天主料不重复（"肉就那几样"）；单菜 N′ 天不重复；
 * 池子太小填不满结构 → 返回 pool-too-small（PRD §6.2「可做的菜不够了，补几道？」）。
 */
import type { MealOccasion, MenuDish, MenuSlot, RelaxedRule, WeekMenu } from "@cfp/kith-inn-shared";
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
  days: string[];
  meals: MealOccasion[];
};

export const DEFAULT_CONSTRAINTS: MenuConstraints = {
  structure: { meat: 2, veg: 2, soup: 1 },
  // "不想跟昨天一样" → 主料 1 天不重（昨天午+晚都不重）；N 可调（PRD §6.2）。
  mainIngredientWindowDays: 1,
  // 单菜 2 天内不重（更宽松——同一道菜隔两天可再做）。
  dishWindowDays: 2,
  days: ["mon", "tue", "wed", "thu", "fri"],
  meals: ["lunch", "dinner"],
};

/** Backwards-compat alias — shared calls this `WeekMenu`. */
export type GenerateMenuResult = WeekMenu;

/** Map an Offering (payload) → the slim MenuDish the core selects on. */
export function toMenuDish(o: Offering): MenuDish {
  return {
    id: o.id,
    name: o.name,
    category: (o.category ?? "veg") as MenuDish["category"],
    mainIngredient: o.mainIngredient,
  };
}

function takeRandom<T>(items: T[], count: number): T[] {
  const rest = [...items];
  const picked: T[] = [];
  while (picked.length < count && rest.length > 0) {
    picked.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]!);
  }
  return picked;
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

function adaptiveLookbackSlots(available: number, perSlot: number, desired: number): number {
  if (perSlot <= 0) return desired;
  // ponytail: k-slot lookback needs at least (k + 1) * perSlot items; shrink k until the pool can rotate.
  return Math.max(0, Math.min(desired, Math.floor(available / perSlot) - 1));
}

type SlotFail = Extract<GenerateMenuResult, { ok: false }>;

/** Pick meat/veg for a slot: structure count + mainIngredient no-repeat + dish no-repeat. */
function pickConstrained(
  pool: MenuDish[],
  cat: "meat" | "veg",
  count: number,
  prior: Slot[],
  desiredDishLbSlots: number,
  desiredMiLbSlots: number,
): { dishes: MenuDish[] } | { failed: { category: string; needed: number; available: number } } {
  const categoryPool = pool.filter((d) => d.category === cat);
  const mainIngredientCount = new Set(categoryPool.map((d) => d.mainIngredient).filter(Boolean)).size;
  const dishLb = lookbackFrom(prior, adaptiveLookbackSlots(categoryPool.length, count, desiredDishLbSlots));
  const miLb = lookbackFrom(prior, adaptiveLookbackSlots(mainIngredientCount, count, desiredMiLbSlots));
  const candidates = categoryPool
    .filter((d) => !dishLb.dishIds.has(String(d.id)))
    .filter((d) => !d.mainIngredient || !miLb.mainIngredients.has(d.mainIngredient));
  return candidates.length >= count
    ? { dishes: takeRandom(candidates, count) }
    : { failed: { category: cat, needed: count, available: candidates.length } };
}

/** Pick soup for a slot: random rotation — few soup options, recurrence is
 *  unavoidable, so soup is exempt from the no-repeat windows (only fails if the pool
 *  has fewer soups than the structure needs). */
function pickSoup(pool: MenuDish[], count: number, dishLb: Lookback): { dishes: MenuDish[] } | { failed: { category: string; needed: number; available: number } } {
  const soups = pool.filter((d) => d.category === "soup");
  // Prefer soups not in the dish lookback; fall back to the full soup pool if all are recent.
  const fresh = soups.filter((d) => !dishLb.dishIds.has(String(d.id)));
  const candidates = fresh.length >= count ? fresh : soups;
  return candidates.length >= count
    ? { dishes: takeRandom(candidates, count) }
    : { failed: { category: "soup", needed: count, available: candidates.length } };
}

/** Pick one slot's dishes: structure × category, honoring no-repeat (meat/veg) + soup rotation. */
function pickSlot(
  pool: MenuDish[],
  prior: Slot[],
  c: MenuConstraints,
  dishLbSlots: number,
  miLbSlots: number,
  slotLabel: string,
): { dishes: MenuDish[] } | SlotFail {
  const picked: MenuDish[] = [];
  for (const [cat, count] of [["meat", c.structure.meat], ["veg", c.structure.veg]] as const) {
    if (count === 0) continue;
    const res = pickConstrained(pool, cat, count, prior, dishLbSlots, miLbSlots);
    if ("dishes" in res) picked.push(...res.dishes);
    else return { ok: false, reason: "pool-too-small", missing: { ...res.failed, slot: slotLabel } };
  }
  if (c.structure.soup > 0) {
    const res = pickSoup(pool, c.structure.soup, lookbackFrom(prior, dishLbSlots));
    if ("dishes" in res) picked.push(...res.dishes);
    else return { ok: false, reason: "pool-too-small", missing: { ...res.failed, slot: slotLabel } };
  }
  return { dishes: picked };
}

/**
 * Generate a full week menu (Mon–Fri × lunch+dinner by default). Each slot honors the structure + the
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
    for (const occasion of c.meals) {
      const label = `${day}-${occasion}`;
      const prior = [...history, ...menu];
      const res = pickSlot(
        input.pool,
        prior,
        c,
        dishLbSlots,
        miLbSlots,
        label,
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
  | { ok: true; replacement: MenuDish; targetIndex: number; relaxedRules: RelaxedRule[] }
  | { ok: false; reason: "slot-not-found" | "dish-not-in-slot" | "no-alternative" };

type SwapScore = [number, number, number, number];

const DAY_MS = 86_400_000;
const RELAXED_RULES: RelaxedRule[] = [
  "same-week-offering",
  "same-day-main-ingredient",
  "recent-offering",
  "recent-main-ingredient",
];
const sameId = (left: string | number, right: string | number) => String(left) === String(right);
const dateNumber = (value: string) => Date.parse(`${value}T00:00:00.000Z`);

function weekMonday(value: string): number {
  const day = new Date(dateNumber(value)).getUTCDay();
  return dateNumber(value) - ((day + 6) % 7) * DAY_MS;
}

function isRecent(slotDay: string, targetDay: string): boolean {
  const days = (dateNumber(targetDay) - dateNumber(slotDay)) / DAY_MS;
  return days >= 1 && days <= 7;
}

function countDishes(slots: Slot[], predicate: (slot: Slot, dish: MenuDish) => boolean): number {
  return slots.reduce((total, slot) => total + slot.dishes.filter((dish) => predicate(slot, dish)).length, 0);
}

function scoreSwapCandidate(candidate: MenuDish, targetDay: string, history: Slot[], remaining: MenuDish[]): SwapScore {
  const main = candidate.mainIngredient;
  return [
    countDishes(history, (slot, dish) => weekMonday(slot.day) === weekMonday(targetDay) && sameId(dish.id, candidate.id)),
    (main ? countDishes(history, (slot, dish) => slot.day === targetDay && dish.mainIngredient === main) : 0)
      + (main ? remaining.filter((dish) => dish.mainIngredient === main).length : 0),
    countDishes(history, (slot, dish) => isRecent(slot.day, targetDay) && sameId(dish.id, candidate.id)),
    main ? countDishes(history, (slot, dish) => isRecent(slot.day, targetDay) && dish.mainIngredient === main) : 0,
  ];
}

function compareSwapScore(left: SwapScore, right: SwapScore): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

function chooseSwapCandidate(
  candidates: MenuDish[],
  targetDay: string,
  history: Slot[],
  remaining: MenuDish[],
  random: () => number,
): { replacement: MenuDish; score: SwapScore } {
  const scored = candidates.map((replacement) => ({ replacement, score: scoreSwapCandidate(replacement, targetDay, history, remaining) }));
  const best = scored.reduce((winner, candidate) => compareSwapScore(candidate.score, winner.score) < 0 ? candidate : winner);
  const tied = scored.filter((candidate) => compareSwapScore(candidate.score, best.score) === 0);
  if (tied.length === 1) return tied[0]!;
  const sample = random();
  const bounded = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
  return tied[Math.min(Math.floor(bounded * tied.length), tied.length - 1)]!;
}

function resolveTargetIndex(slot: Slot, dishId: string | number, dishIndex?: number): number {
  if (dishIndex === undefined) return slot.dishes.findIndex((dish) => sameId(dish.id, dishId));
  if (!Number.isInteger(dishIndex) || dishIndex < 0) return -1;
  const dish = slot.dishes[dishIndex];
  return dish && sameId(dish.id, dishId) ? dishIndex : -1;
}

/**
 * 一键换菜：资格只要求同分类、非目标且当前餐未使用；历史与主料冲突进入四级评分，
 * 只在最优分并列时随机。
 */
export function swapDish(input: {
  menu: Slot[];
  target: { day: string; occasion: MealOccasion };
  dishId: string | number;
  dishIndex?: number;
  pool: MenuDish[];
  history?: Slot[];
  random?: () => number;
  constraints?: Partial<MenuConstraints>;
}): SwapResult {
  const slot = input.menu.find((s) => s.day === input.target.day && s.occasion === input.target.occasion);
  if (!slot) return { ok: false, reason: "slot-not-found" };
  const targetIndex = resolveTargetIndex(slot, input.dishId, input.dishIndex);
  if (targetIndex < 0) return { ok: false, reason: "dish-not-in-slot" };
  const target = slot.dishes[targetIndex]!;

  const inSlotIds = new Set(slot.dishes.map((dish) => String(dish.id)));
  const candidates = input.pool
    .filter((dish) => dish.category === target.category && !sameId(dish.id, target.id))
    .filter((dish) => !inSlotIds.has(String(dish.id)));
  if (candidates.length === 0) return { ok: false, reason: "no-alternative" };
  const picked = chooseSwapCandidate(
    candidates,
    input.target.day,
    input.history ?? [],
    slot.dishes.filter((_, index) => index !== targetIndex),
    input.random ?? Math.random,
  );
  return {
    ok: true,
    replacement: picked.replacement,
    targetIndex,
    relaxedRules: RELAXED_RULES.filter((_, index) => picked.score[index]! > 0),
  };
}

export type SwapSpecifiedResult =
  | { ok: true; replacement: MenuDish; targetIndex: number; warning?: string }
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
  dishIndex?: number;
  replacementId: string | number;
  pool: MenuDish[];
  history?: Slot[];
  constraints?: Partial<MenuConstraints>;
}): SwapSpecifiedResult {
  const c: MenuConstraints = { ...DEFAULT_CONSTRAINTS, ...input.constraints };
  const slot = input.menu.find((s) => s.day === input.target.day && s.occasion === input.target.occasion);
  if (!slot) return { ok: false, reason: "slot-not-found" };
  const targetIndex = resolveTargetIndex(slot, input.dishId, input.dishIndex);
  if (targetIndex < 0) return { ok: false, reason: "dish-not-in-slot" };
  const target = slot.dishes[targetIndex]!;
  const replacement = input.pool.find((d) => String(d.id) === String(input.replacementId));
  if (!replacement) return { ok: false, reason: "replacement-not-in-pool" };
  if (String(replacement.id) === String(target.id)) return { ok: false, reason: "replacement-same-as-target" };

  const idx = input.menu.indexOf(slot);
  const mealsPerDay = Math.max(1, c.meals.length);
  const miLbSlots = c.mainIngredientWindowDays * mealsPerDay;
  const neighborSlots = input.history
    ? input.history.filter((historySlot) => Math.abs(dateNumber(historySlot.day) - dateNumber(input.target.day)) <= c.mainIngredientWindowDays * DAY_MS)
    : input.menu.filter((_, i) => i !== idx && Math.abs(i - idx) <= miLbSlots);
  const neighborMi = collectFrom(neighborSlots).mainIngredients;
  const inSlotOtherMi = new Set(
    slot.dishes.filter((_, index) => index !== targetIndex).filter((dish) => dish.mainIngredient).map((dish) => dish.mainIngredient),
  );
  const clash = !!replacement.mainIngredient && (neighborMi.has(replacement.mainIngredient) || inSlotOtherMi.has(replacement.mainIngredient));
  return clash
    ? { ok: true, replacement, targetIndex, warning: "会和近期主料重复，仍要换吗？" }
    : { ok: true, replacement, targetIndex };
}

/**
 * date-driven 生成（feature 003）：按任意 `targets: [{date, occasion}]` 列表生成，
 * 复用 `pickSlot` + lookback（主料/单菜避重、汤轮换）。与 `generateWeekMenu`
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
  for (const t of input.targets) {
    const prior = [...history, ...menu];
    const res = pickSlot(
      input.pool,
      prior,
      c,
      dishLbSlots,
      miLbSlots,
      `${t.date}-${t.occasion}`,
    );
    if ("dishes" in res) menu.push({ day: t.date, occasion: t.occasion, dishes: res.dishes });
    else return res;
  }
  return { ok: true, menu };
}
