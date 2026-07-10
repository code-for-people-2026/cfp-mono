import {
  generateMenusInputSchema,
  mealSlotRangeSchema,
  swapMenuItemInputSchema
} from "@cfp/kith-inn-v1-shared/api";
import type {
  MealSlot,
  MealSlotCreate,
  MealSlotTarget,
  MealSlotUpdate,
  Offering
} from "@cfp/kith-inn-v1-shared";
import { Hono, type Context } from "hono";
import {
  addCalendarDays,
  generateMenus,
  OfferingPoolInsufficientError,
  swapMenuItem
} from "../domain/menu/generate";
import {
  CmsMealSlotError,
  createMealSlot as createMealSlotFn,
  getMealSlot as getMealSlotFn,
  listMealSlots as listMealSlotsFn,
  updateMealSlot as updateMealSlotFn
} from "../lib/cms/mealSlots";
import {
  CmsOfferingError,
  listOfferings as listOfferingsFn
} from "../lib/cms/offerings";
import { operatorAuth, type AppVars } from "../middleware/operatorAuth";

export type MealSlotsDeps = {
  listOfferings: (token: string, active: "true") => Promise<Offering[]>;
  listMealSlots: (token: string, range: { from: string; to: string }) => Promise<MealSlot[]>;
  getMealSlot: (token: string, id: string | number) => Promise<MealSlot>;
  createMealSlot: (token: string, input: MealSlotCreate) => Promise<MealSlot>;
  updateMealSlot: (token: string, id: string | number, input: MealSlotUpdate) => Promise<MealSlot>;
  now: () => string;
  random: () => number;
};

const defaultDeps: MealSlotsDeps = {
  listOfferings: (token, active) => listOfferingsFn(token, active),
  listMealSlots: (token, range) => listMealSlotsFn(token, range),
  getMealSlot: (token, id) => getMealSlotFn(token, id),
  createMealSlot: (token, input) => createMealSlotFn(token, input),
  updateMealSlot: (token, id, input) => updateMealSlotFn(token, id, input),
  now: () => new Date().toISOString(),
  random: Math.random
};

async function bodyOf(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function dependencyError(c: Context, error: unknown) {
  if (!(error instanceof CmsMealSlotError) && !(error instanceof CmsOfferingError)) {
    return c.json({ error: "cms-unavailable", message: "菜单服务暂不可用" }, 502);
  }
  const status = ([401, 403, 404, 409, 422] as const).includes(error.status as 401)
    ? error.status as 401 | 403 | 404 | 409 | 422
    : 502;
  return c.json({ error: error.code, message: error.message }, status);
}

const keyOf = ({ date, occasion }: MealSlotTarget) => `${date}:${occasion}`;

function generationRanges(targets: MealSlotTarget[]) {
  const dates = [...new Set(targets.map(({ date }) => date))].sort();
  return dates.reduce<Array<{ from: string; to: string }>>((ranges, date) => {
    const current = ranges.at(-1);
    if (!current || date > addCalendarDays(current.from, 30)) {
      ranges.push({ from: addCalendarDays(date, -7), to: date });
    } else {
      current.to = date;
    }
    return ranges;
  }, []);
}

async function persistMenu(
  token: string,
  target: MealSlotTarget,
  menuItems: MealSlotUpdate["menuItems"],
  generatedAt: string,
  existing: MealSlot | undefined,
  replaceExisting: boolean,
  deps: MealSlotsDeps
): Promise<MealSlot> {
  const patch = { menuItems, generatedAt };
  if (existing) return deps.updateMealSlot(token, existing.id, patch);
  try {
    return await deps.createMealSlot(token, { ...target, ...patch });
  } catch (error) {
    if (!(error instanceof CmsMealSlotError) || error.status !== 409 || !replaceExisting) throw error;
    const raced = (await deps.listMealSlots(token, { from: target.date, to: target.date }))
      .find((slot) => keyOf(slot) === keyOf(target));
    if (!raced) throw error;
    return deps.updateMealSlot(token, raced.id, patch);
  }
}

export function mealSlotsRoutes(secret: string, deps: MealSlotsDeps = defaultDeps) {
  const app = new Hono<AppVars>();
  app.use("*", operatorAuth(secret));

  app.get("/", async (c) => {
    const parsed = mealSlotRangeSchema.safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!parsed.success) return c.json({ error: "invalid-date-range", message: "日期范围无效" }, 400);
    try {
      return c.json({ docs: await deps.listMealSlots(c.get("operatorToken"), parsed.data) });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  app.post("/generate-menus", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = generateMenusInputSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-menu-targets", message: "菜单目标无效" }, 422);
    const token = c.get("operatorToken");
    try {
      const slotBatches = await Promise.all(
        generationRanges(parsed.data.targets).map((range) => deps.listMealSlots(token, range))
      );
      const slots = [...new Map(slotBatches.flat().map((slot) => [keyOf(slot), slot])).values()];
      const targetKeys = new Set(parsed.data.targets.map(keyOf));
      const existing = slots.filter((slot) => targetKeys.has(keyOf(slot)));
      if (existing.length > 0 && !parsed.data.replaceExisting) {
        return c.json({
          error: "meal-slots-exist",
          message: "目标餐次已有菜单，请确认覆盖",
          existingTargets: existing.map(({ date, occasion }) => ({ date, occasion }))
        }, 409);
      }
      const generated = generateMenus({
        offerings: await deps.listOfferings(token, "true"),
        targets: parsed.data.targets,
        history: slots.filter((slot) => !targetKeys.has(keyOf(slot))),
        random: deps.random
      });
      const existingByKey = new Map(existing.map((slot) => [keyOf(slot), slot]));
      const generatedAt = deps.now();
      const docs: MealSlot[] = [];
      for (const menu of generated.menus) {
        docs.push(await persistMenu(
          token,
          menu.target,
          menu.menuItems,
          generatedAt,
          existingByKey.get(keyOf(menu.target)),
          parsed.data.replaceExisting,
          deps
        ));
      }
      return c.json({ docs, relaxedRules: generated.relaxedRules });
    } catch (error) {
      if (error instanceof OfferingPoolInsufficientError) {
        return c.json({
          error: "offering-pool-insufficient",
          message: "菜品池分类不足，无法生成完整菜单",
          shortages: error.shortages
        }, 422);
      }
      return dependencyError(c, error);
    }
  });

  app.post("/:id/swap-menu-item", async (c) => {
    const body = await bodyOf(c);
    if (!body.ok) return c.json({ error: "invalid-json", message: "请求不是合法 JSON" }, 400);
    const parsed = swapMenuItemInputSchema.safeParse(body.value);
    if (!parsed.success) return c.json({ error: "invalid-swap-input", message: "换菜参数无效" }, 422);
    const token = c.get("operatorToken");
    try {
      const slot = await deps.getMealSlot(token, c.req.param("id"));
      if (!slot.menuItems.some((item) => String(item.offeringId) === String(parsed.data.offeringId))) {
        return c.json({ error: "menu-item-not-found", message: "目标菜单项不存在" }, 404);
      }
      const swapped = swapMenuItem({
        slot,
        offeringId: parsed.data.offeringId,
        offerings: await deps.listOfferings(token, "true"),
        history: await deps.listMealSlots(token, { from: addCalendarDays(slot.date, -7), to: slot.date }),
        random: deps.random
      });
      if (!swapped) return c.json({ error: "no-swap-candidate", message: "没有可替换的同类菜品" }, 409);
      const doc = await deps.updateMealSlot(token, slot.id, {
        menuItems: swapped.menuItems,
        generatedAt: deps.now()
      });
      return c.json({ doc, relaxedRules: swapped.relaxedRules });
    } catch (error) {
      return dependencyError(c, error);
    }
  });

  return app;
}
