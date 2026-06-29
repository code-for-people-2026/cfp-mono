import { Hono } from "hono";
import type { Fulfillment } from "@cfp/kith-inn-shared";
import { gapReport, packingSort } from "../domain/delivery/derivations";
import { listFulfillments as listFulfillmentsFn } from "../lib/cms/orders";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = real fetch client). */
export type DeliveryDeps = {
  listFulfillments: (jwt: string, query: { date?: string; occasion?: string }) => Promise<Fulfillment[]>;
};

/**
 * `GET /delivery?date=&occasion=` — 送餐 tab 数据源：按楼栋分拣（源头防错）+ 缺口对账
 * （收尾防漏）。两个派生都在 be 算（§7.5 派生不落表）；cms 只给原始 fulfillments。
 */
export function deliveryRoutes(jwtSecret: string, deps: DeliveryDeps = { listFulfillments: listFulfillmentsFn }) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));
  app.get("/", async (c) => {
    const fulfillments = await deps.listFulfillments(c.get("token") as string, {
      date: c.req.query("date") || undefined,
      occasion: c.req.query("occasion") || undefined,
    });
    return c.json({ sort: packingSort(fulfillments), gaps: gapReport(fulfillments) });
  });
  return app;
}
