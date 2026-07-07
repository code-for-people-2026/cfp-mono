import { Hono } from "hono";
import type { Fulfillment } from "@cfp/kith-inn-shared";
import { gapReport, packingSort } from "../domain/delivery/derivations";
import { listFulfillments as listFulfillmentsFn, setFulfillmentsByIds as setFulfillmentsByIdsFn } from "../lib/cms/orders";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = real fetch client). */
export type DeliveryDeps = {
  listFulfillments: (jwt: string, query: { date?: string; occasion?: string }) => Promise<Fulfillment[]>;
  setFulfillmentsByIds: typeof setFulfillmentsByIdsFn;
};

/**
 * `GET /delivery?date=&occasion=` — 送餐 tab 数据源：按楼栋分拣（源头防错）+ 缺口对账
 * （收尾防漏）。两个派生都在 be 算（§7.5 派生不落表）；cms 只给原始 fulfillments。
 * canceled（终态）不计入视图与计数。
 *
 * `PATCH /fulfillments` — 确定性「送达」勾销（订单页/today 卡片按钮用）：`{ ids: [...] }`
 * 精确标这几个 fulfillment done（避免 substring 跨地址误伤，Codex P1）。历史的 `{ address }`
 * 片段模式（agent/语音用）随 agent mark_delivered 一并移除——UI 走精确 ids。
 */
export function deliveryRoutes(
  jwtSecret: string,
  deps: DeliveryDeps = { listFulfillments: listFulfillmentsFn, setFulfillmentsByIds: setFulfillmentsByIdsFn },
) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));
  app.get("/", async (c) => {
    const fulfillments = await deps.listFulfillments(c.get("token") as string, {
      date: c.req.query("date") || undefined,
      occasion: c.req.query("occasion") || undefined,
    });
    const active = fulfillments.filter((f) => f.status !== "canceled"); // Codex P2: terminal state, exclude from view + counts
    return c.json({ sort: packingSort(active), gaps: gapReport(active) });
  });

  app.patch("/fulfillments", async (c) => {
    const jwt = c.get("token") as string;
    const body = (await c.req.json().catch(() => null)) as { ids?: unknown } | null;
    try {
      // Exact path (orders-page / today-card buttons): mark exactly these fulfillment ids
      // done — no substring spillover across addresses like "3A" matching "13A" (Codex P1).
      if (Array.isArray(body?.ids) && body.ids.length > 0) {
        const ids = body!.ids as Array<string | number>;
        await deps.setFulfillmentsByIds(jwt, ids, { status: "done" });
        return c.json({ ok: true, count: ids.length });
      }
      return c.json({ error: "ids required" }, 400);
    } catch {
      return c.json({ error: "mark failed" }, 502);
    }
  });

  return app;
}
