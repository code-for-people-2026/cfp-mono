/**
 * 确定性选菜内核（PRD §6.2 — "她最头疼的一步"）。**纯函数、零 LLM**——LLM 只在润色层
 * （polish.ts）做菜名/文案，绝不参与"选哪道菜"的决策。从根上杜绝"推荐她不会做的菜"：
 * 只从池内选、满足去重/费工/频次约束，可被确定性单测 100% 覆盖。
 *
 * 约束：只选池内 component；最近 N 天主料不重复（"肉就那几样"）；单菜 N′ 天不重复；
 * 费工菜每顿 ≤ 阈值（"避免一天全是麻烦菜"）；频次加权（常做优先、冷门偶尔翻新）。
 * 池子太小填不满结构 → 返回 pool-too-small（PRD §6.2「可做的菜不够了，补几道？」）。
 */
import type { Offering } from "@cfp/kith-inn-shared";

export type MenuDish = {
  id: string | number;
  name: string;
  category: "meat" | "veg" | "soup" | "staple";
  mainIngredient?: string;
  tags?: string[];
  useCount?: number;
  lastUsedAt?: string;
};

export type MealOccasion = "lunch" | "dinner";

export type Slot = { day: string; occasion: MealOccasion; dishes: MenuDish[] };

export type MenuConstraints = {
  /** per-slot 荤素结构（默认 2 荤 2 素 1 汤 = 桃子"4 菜 1 汤"）。 */
  structure: { meat: number; veg: number; soup: number };
  /** 主料 N 天内不重复（默认 2——"不想跟昨天一样"）。 */
  mainIngredientWindowDays: number;
  /** 单菜 N 天内不重复（默认 3）。 */
  dishWindowDays: number;
  /** 每顿费工菜上限（默认 1）。 */
  laboriousMaxPerSlot: number;
  days: string[];
  meals: MealOccasion[];
};

export const DEFAULT_CONSTRAINTS: MenuConstraints = {
  structure: { meat: 2, veg: 2, soup: 1 },
  // "不想跟昨天一样" → 主料 1 天不重（昨天午+晚都不重）；N 可调（PRD §6.2）。
  mainIngredientWindowDays: 1,
  // 单菜 2 天内不重（更宽松——同一道菜隔两天可再做）。
  dishWindowDays: 2,
  laboriousMaxPerSlot: 1,
  days: ["mon", "tue", "wed", "thu", "fri"],
  meals: ["lunch", "dinner"],
};

const LABORIOUS_TAG = "费工";

export type GenerateMenuResult =
  | { ok: true; menu: Slot[] }
  | { ok: false; reason: "pool-too-small"; missing: { category: string; needed: number; available: number; slot: string } };

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

/** Build the no-repeat lookback from the most recent `k` slots' dishes. */
function lookbackFrom(slots: Slot[], k: number): Lookback {
  const dishIds = new Set<string>();
  const mainIngredients = new Set<string>();
  for (const s of slots.slice(-k)) {
    for (const d of s.dishes) {
      dishIds.add(String(d.id));
      if (d.mainIngredient) mainIngredients.add(d.mainIngredient);
    }
  }
  return { dishIds, mainIngredients };
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

/** Pick one slot's dishes: structure × category, honoring no-repeat (meat/veg) + LRU soup + 费工 cap. */
function pickSlot(
  pool: MenuDish[],
  dishLb: Lookback,
  miLb: Lookback,
  c: MenuConstraints,
  slotLabel: string,
): { dishes: MenuDish[] } | SlotFail {
  const picked: MenuDish[] = [];
  const laborious = { count: 0, max: c.laboriousMaxPerSlot };
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
    for (const occasion of c.meals) {
      const label = `${day}-${occasion}`;
      const prior = [...history, ...menu];
      const res = pickSlot(
        input.pool,
        lookbackFrom(prior, dishLbSlots),
        lookbackFrom(prior, miLbSlots),
        c,
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
  const mealsPerDay = Math.max(1, c.meals.length);
  const dishLbSlots = c.dishWindowDays * mealsPerDay;
  const miLbSlots = c.mainIngredientWindowDays * mealsPerDay;

  // lookback = other slots in the menu (exclude the target slot itself)
  const otherSlots = input.menu.filter((s) => s !== slot);
  const dishLb = lookbackFrom(otherSlots, dishLbSlots);
  const miLb = lookbackFrom(otherSlots, miLbSlots);
  const inSlotIds = new Set(slot.dishes.map((d) => String(d.id)));
  const inSlotMI = new Set(slot.dishes.filter((d) => d.mainIngredient).map((d) => d.mainIngredient));
  const laboriousAlready = slot.dishes.filter((d) => (d.tags ?? []).includes(LABORIOUS_TAG)).length;
  const targetIsLaborious = (target.tags ?? []).includes(LABORIOUS_TAG);
  const laboriousBudget = c.laboriousMaxPerSlot - laboriousAlready + (targetIsLaborious ? 1 : 0);

  const alt = input.pool
    .filter((d) => d.category === target.category && String(d.id) !== String(target.id))
    .filter((d) => !dishLb.dishIds.has(String(d.id)))
    .filter((d) => !inSlotIds.has(String(d.id)))
    .filter((d) => !d.mainIngredient || (!miLb.mainIngredients.has(d.mainIngredient) && !inSlotMI.has(d.mainIngredient)))
    .filter((d) => !(d.tags ?? []).includes(LABORIOUS_TAG) || laboriousBudget > 0)
    .sort(compareDishes)[0];
  return alt ? { ok: true, replacement: alt } : { ok: false, reason: "no-alternative" };
}
