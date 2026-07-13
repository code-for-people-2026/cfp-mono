/**
 * 选菜内核（PRD §6.2 — "她最头疼的一步"）。**零 LLM**——LLM 只在润色层
 * （polish.ts）做菜名/文案，绝不参与"选哪道菜"的决策。从根上杜绝"推荐她不会做的菜"：
 * 只从池内选、满足去重约束。
 *
 * 约束：只选池内 component；最近 N 天主料不重复（"肉就那几样"）；单菜 N′ 天不重复；
 * 池子太小填不满结构 → 返回 pool-too-small（PRD §6.2「可做的菜不够了，补几道？」）。
 */
import { RELAXED_RULES } from "@cfp/kith-inn-shared";
import type { MealOccasion, MenuDish, MenuSlot, Offering, RelaxedRule, WeekMenu } from "@cfp/kith-inn-shared";

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

export type SwapConflictScore = readonly [number, number, number, number];

const DAY_MS = 86_400_000;
const idEquals = (left: string | number, right: string | number): boolean => String(left) === String(right);
const dateNumber = (value: string): number => Date.parse(`${value}T00:00:00.000Z`);

function weekKey(value: string): string | undefined {
  const time = dateNumber(value);
  if (!Number.isFinite(time)) return undefined;
  const date = new Date(time);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(time - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

function isRecent(slotDate: string, targetDate: string): boolean {
  const days = (dateNumber(targetDate) - dateNumber(slotDate)) / DAY_MS;
  return Number.isFinite(days) && days >= 1 && days <= 7;
}

/** 计算候选的固定四级冲突次数；history 必须由 caller 排除当前 plan。 */
export function scoreSwapCandidate(input: {
  candidate: MenuDish;
  targetDate: string;
  history: Slot[];
  remaining: MenuDish[];
}): SwapConflictScore {
  const score: [number, number, number, number] = [0, 0, 0, 0];
  const targetWeek = weekKey(input.targetDate);
  const main = input.candidate.mainIngredient;
  for (const slot of input.history) {
    const sameWeek = targetWeek !== undefined && weekKey(slot.day) === targetWeek;
    const recent = isRecent(slot.day, input.targetDate);
    for (const dish of slot.dishes) {
      const sameOffering = idEquals(dish.id, input.candidate.id);
      const sameMain = main !== undefined && dish.mainIngredient === main;
      if (sameWeek && sameOffering) score[0] += 1;
      if (slot.day === input.targetDate && sameMain) score[1] += 1;
      if (recent && sameOffering) score[2] += 1;
      if (recent && sameMain) score[3] += 1;
    }
  }
  if (main !== undefined) {
    score[1] += input.remaining.filter((dish) => dish.mainIngredient === main).length;
  }
  return score;
}

function compareSwapScore(left: SwapConflictScore, right: SwapConflictScore): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return 0;
}

function relaxedRulesFrom(score: SwapConflictScore): RelaxedRule[] {
  return RELAXED_RULES.filter((_, index) => score[index]! > 0);
}

function resolveSwapTarget(slot: Slot, dishId: string | number, dishIndex?: number): { dish: MenuDish; index: number } | undefined {
  const index = dishIndex === undefined
    ? slot.dishes.findIndex((dish) => idEquals(dish.id, dishId))
    : dishIndex;
  if (!Number.isInteger(index) || index < 0) return undefined;
  const dish = slot.dishes[index];
  return dish && idEquals(dish.id, dishId) ? { dish, index } : undefined;
}

function tiedRandomIndex(length: number, random: () => number): number {
  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.max(0, sample) : 0;
  return Math.min(Math.floor(normalized * length), length - 1);
}

export type SwapResult =
  | { ok: true; replacement: MenuDish; targetIndex: number; relaxedRules: RelaxedRule[] }
  | { ok: false; reason: "slot-not-found" | "dish-not-in-slot" | "no-alternative" };

/**
 * 一键换菜：先保留全部同类有效候选，再按四级冲突次数择优；只有并列最优才随机。
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
  const resolved = resolveSwapTarget(slot, input.dishId, input.dishIndex);
  if (!resolved) return { ok: false, reason: "dish-not-in-slot" };
  const inSlotIds = new Set(slot.dishes.map((d) => String(d.id)));
  const candidates = input.pool
    .filter((dish) => dish.category === resolved.dish.category && !idEquals(dish.id, resolved.dish.id))
    .filter((dish) => !inSlotIds.has(String(dish.id)));
  if (candidates.length === 0) return { ok: false, reason: "no-alternative" };

  const remaining = slot.dishes.filter((_, index) => index !== resolved.index);
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreSwapCandidate({ candidate, targetDate: slot.day, history: input.history ?? [], remaining }),
  }));
  const bestScore = scored.reduce((best, item) => compareSwapScore(item.score, best) < 0 ? item.score : best, scored[0]!.score);
  const tied = scored.filter((item) => compareSwapScore(item.score, bestScore) === 0);
  const winner = tied.length === 1 ? tied[0]! : tied[tiedRandomIndex(tied.length, input.random ?? Math.random)]!;
  return {
    ok: true,
    replacement: winner.candidate,
    targetIndex: resolved.index,
    relaxedRules: relaxedRulesFrom(winner.score),
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
  constraints?: Partial<MenuConstraints>;
}): SwapSpecifiedResult {
  const c: MenuConstraints = { ...DEFAULT_CONSTRAINTS, ...input.constraints };
  const slot = input.menu.find((s) => s.day === input.target.day && s.occasion === input.target.occasion);
  if (!slot) return { ok: false, reason: "slot-not-found" };
  const resolved = resolveSwapTarget(slot, input.dishId, input.dishIndex);
  if (!resolved) return { ok: false, reason: "dish-not-in-slot" };
  const replacement = input.pool.find((d) => String(d.id) === String(input.replacementId));
  if (!replacement) return { ok: false, reason: "replacement-not-in-pool" };
  if (idEquals(replacement.id, resolved.dish.id)) return { ok: false, reason: "replacement-same-as-target" };

  const idx = input.menu.indexOf(slot);
  const mealsPerDay = Math.max(1, c.meals.length);
  const miLbSlots = c.mainIngredientWindowDays * mealsPerDay;
  const neighborMi = collectFrom(input.menu.filter((_, i) => i !== idx && Math.abs(i - idx) <= miLbSlots)).mainIngredients;
  const inSlotOtherMi = new Set(
    slot.dishes.filter((_, index) => index !== resolved.index).filter((dish) => dish.mainIngredient).map((dish) => dish.mainIngredient),
  );
  const clash = !!replacement.mainIngredient && (neighborMi.has(replacement.mainIngredient) || inSlotOtherMi.has(replacement.mainIngredient));
  return clash
    ? { ok: true, replacement, targetIndex: resolved.index, warning: "会和近期主料重复，仍要换吗？" }
    : { ok: true, replacement, targetIndex: resolved.index };
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
