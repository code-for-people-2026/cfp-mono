import { Hono } from "hono";
import type { Offering } from "@cfp/kith-inn-shared";
import { findOfferings as findOfferingsFn } from "../lib/cms/client";
import { generateWeekMenu, toMenuDish } from "../domain/menu/core";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = real fetch client). */
export type MenuDeps = { findOfferings: (jwt: string) => Promise<Offering[]> };

/**
 * `GET /menu/week` — 菜单 tab 数据源：从卖家的菜品池确定性生成一周菜单（core.generateWeekMenu）。
 * 池太小填不满结构 → `{ok:false, reason:"pool-too-small", missing}`（PRD §6.2「补几道？」）。
 */
export function menuRoutes(jwtSecret: string, deps: MenuDeps = { findOfferings: findOfferingsFn }) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));
  app.get("/week", async (c) => {
    const offerings = await deps.findOfferings(c.get("token") as string);
    const pool = offerings.filter((o) => o.active !== false).map(toMenuDish);
    return c.json(generateWeekMenu({ pool }));
  });
  return app;
}
