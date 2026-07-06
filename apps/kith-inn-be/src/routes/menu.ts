import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { MenuPlan, MenuPlanView, Offering, Seller } from "@cfp/kith-inn-shared";
import { swapRequestSchema } from "@cfp/kith-inn-shared/schemas";
import { findOfferings as findOfferingsFn } from "../lib/cms/client";
import { CmsHttpError, getSeller as getSellerFn } from "../lib/cms/orders";
import {
  getMenuPlan as getMenuPlanFn,
  listMenuPlans as listMenuPlansFn,
  patchMenuPlan as patchMenuPlanFn,
  upsertMenuPlans as upsertMenuPlansFn,
  type MenuPlanPatch,
  type MenuPlanUpsertInput,
} from "../lib/cms/menuPlans";
import { generateForTargets, generateWeekMenu, swapDish, swapDishSpecified, toMenuDish } from "../domain/menu/core";
import { buildJielongMenuText } from "../domain/menu/jielongText";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = real cms clients). */
export type MenuDeps = {
  findOfferings: (jwt: string) => Promise<Offering[]>;
  listMenuPlans: (jwt: string, query: { from: string; to: string }) => Promise<MenuPlan[]>;
  getMenuPlan: (jwt: string, id: string | number) => Promise<MenuPlan>;
  upsertMenuPlans: (jwt: string, items: MenuPlanUpsertInput[]) => Promise<MenuPlan[]>;
  patchMenuPlan: (jwt: string, id: string | number, patch: MenuPlanPatch) => Promise<MenuPlan>;
  getSeller: (jwt: string) => Promise<Seller>;
};

const cmsStatus = (e: unknown, fallback: ContentfulStatusCode = 502): ContentfulStatusCode =>
  e instanceof CmsHttpError ? (e.status as ContentfulStatusCode) : fallback;

/** cms MenuPlan (depth-populated slot + offerings, cms guarantees depth:1) → MenuPlanView. */
function toView(plan: MenuPlan): MenuPlanView {
  const slot = plan.slot as unknown as { date: string; occasion: "lunch" | "dinner" };
  return {
    planId: plan.id,
    date: slot.date,
    occasion: slot.occasion,
    status: plan.status,
    dishes: (plan.offerings as unknown as Offering[]).map(toMenuDish),
    publishText: plan.publishText,
  };
}

const poolFrom = (offerings: Offering[]) => offerings.filter((o) => o.active !== false && o.kind === "component").map(toMenuDish);

/**
 * Menu routes (PRD §6.2). All sellerAuth-protected; JWT forwarded to cms as seller-token
 * passthrough. GET /week = stateless suggestion (existing). feature 003 adds:
 *  - GET  /plans            回看 menu_plans（date/range）
 *  - POST /generate         生成 + 写 draft plan（覆写；published 需 force）
 *  - POST /plans/:id/swap   换一道（auto/指定+warning；published 需 force；清 publishText）
 *  - POST /plans/:id/publish 一键发布：draft→published + 接龙文案（确定性、不调 LLM）
 */
export function menuRoutes(
  jwtSecret: string,
  deps: MenuDeps = {
    findOfferings: findOfferingsFn,
    listMenuPlans: listMenuPlansFn,
    getMenuPlan: getMenuPlanFn,
    upsertMenuPlans: upsertMenuPlansFn,
    patchMenuPlan: patchMenuPlanFn,
    getSeller: getSellerFn,
  },
) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));

  app.get("/week", async (c) => {
    const offerings = await deps.findOfferings(c.get("token") as string);
    return c.json(generateWeekMenu({ pool: poolFrom(offerings) }));
  });

  /** GET /plans?date= | ?from=&to= — 回看 menu_plans（depth-populated）。 */
  app.get("/plans", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const from = params.get("from") ?? params.get("date");
    const to = params.get("to") ?? params.get("date");
    if (!from || !to) return c.json({ error: "date or from+to required" }, 400);
    try {
      const plans = await deps.listMenuPlans(c.get("token") as string, { from, to });
      return c.json({ plans: plans.map(toView) });
    } catch (e) {
      return c.json({ error: "plans load failed" }, cmsStatus(e));
    }
  });

  /** POST /generate — 生成 + 写 draft plan（targets=[{date,occasion}]；published 需 force）。 */
  app.post("/generate", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { targets?: Array<{ date: string; occasion: "lunch" | "dinner" }>; force?: boolean } | null;
    const targets = body?.targets;
    if (!Array.isArray(targets) || targets.length === 0) return c.json({ error: "targets[] required" }, 400);
    const token = c.get("token") as string;
    try {
      const [offerings, existing] = await Promise.all([
        deps.findOfferings(token),
        // query the full min..max of target dates (targets may be unsorted/non-contiguous, Codex #116 P2)
        deps.listMenuPlans(token, (() => {
          const ds = targets.map((t) => t.date).sort();
          return { from: ds[0]!, to: ds[ds.length - 1]! };
        })()),
      ]);
      const pubKey = new Set(
        existing
          .filter((p) => p.status === "published")
          .map((p) => {
            const s = p.slot as { date?: string; occasion?: string } | undefined;
            return `${s?.date}|${s?.occasion}`;
          }),
      );
      for (const t of targets) {
        if (pubKey.has(`${t.date}|${t.occasion}`) && !body?.force) {
          return c.json({ error: "plan-published", date: t.date, occasion: t.occasion }, 409);
        }
      }
      const result = generateForTargets({ targets, pool: poolFrom(offerings) });
      if (!result.ok) return c.json(result, 200);
      const items: MenuPlanUpsertInput[] = result.menu.map((s) => ({
        date: s.day,
        occasion: s.occasion,
        offerings: s.dishes.map((d) => d.id),
        status: "draft",
      }));
      const written = await deps.upsertMenuPlans(token, items);
      return c.json({ plans: written.map(toView) });
    } catch (e) {
      return c.json({ error: "generate failed" }, cmsStatus(e));
    }
  });

  /** POST /plans/:id/swap — 换一道（auto=swapDish / 指定=swapDishSpecified+warning；published 需 force）。 */
  app.post("/plans/:id/swap", async (c) => {
    const parsed = swapRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "dishId required" }, 400);
    const token = c.get("token") as string;
    const id = c.req.param("id");
    try {
      const plan = await deps.getMenuPlan(token, id);
      if (plan.status === "published" && !parsed.data.force) {
        return c.json({ error: "plan-published" }, 409);
      }
      const offerings = plan.offerings as unknown as Offering[];
      const dishObjs = offerings;
      const pool = (await deps.findOfferings(token)).filter((o) => o.active !== false && o.kind === "component").map(toMenuDish);
      const slotView = toView(plan);
      const menu = [{ day: slotView.date, occasion: slotView.occasion, dishes: slotView.dishes }];
      const target = { day: slotView.date, occasion: slotView.occasion, dishId: parsed.data.dishId };
      let replacementId: string | number;
      let warning: string | undefined;
      if (parsed.data.replacementId !== undefined) {
        const r = swapDishSpecified({ menu, target, dishId: parsed.data.dishId, replacementId: parsed.data.replacementId, pool });
        if (!r.ok) return c.json({ error: r.reason }, 400);
        replacementId = r.replacement.id;
        warning = r.warning;
      } else {
        const r = swapDish({ menu, target, dishId: parsed.data.dishId, pool });
        if (!r.ok) return c.json({ error: r.reason }, 409);
        replacementId = r.replacement.id;
      }
      const newOfferings = dishObjs.map((o) => (String(o.id) === String(parsed.data.dishId) ? replacementId : o.id));
      const patch: MenuPlanPatch = plan.status === "published" ? { offerings: newOfferings, publishText: null } : { offerings: newOfferings };
      const updated = await deps.patchMenuPlan(token, id, patch);
      return c.json({ plan: toView(updated), ...(warning ? { warning } : {}) });
    } catch (e) {
      return c.json({ error: "swap failed" }, cmsStatus(e));
    }
  });

  /** POST /plans/:id/publish — 一键发布：draft→published + 接龙文案（缺失才生成，缓存命中不重生成）。 */
  app.post("/plans/:id/publish", async (c) => {
    const token = c.get("token") as string;
    const id = c.req.param("id");
    try {
      const plan = await deps.getMenuPlan(token, id);
      let text = plan.publishText;
      const patch: MenuPlanPatch = {};
      if (plan.status === "draft") patch.status = "published";
      if (!text) {
        const seller = await deps.getSeller(token);
        const offerings = plan.offerings as unknown as Offering[];
        const slot = plan.slot as unknown as { date: string; occasion: "lunch" | "dinner" };
        text = buildJielongMenuText(
          [{ date: slot.date, occasion: slot.occasion, dishNames: offerings.map((o) => o.name) }],
          { name: seller.name, priceCents: seller.defaultPriceCents },
        );
        patch.publishText = text;
      }
      if (Object.keys(patch).length > 0) {
        await deps.patchMenuPlan(token, id, patch);
      }
      return c.json({ publishText: text });
    } catch (e) {
      return c.json({ error: "publish failed" }, cmsStatus(e));
    }
  });

  return app;
}
