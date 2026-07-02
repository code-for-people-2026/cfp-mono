import { Hono } from "hono";
import type { Fulfillment } from "@cfp/kith-inn-shared";
import { fulfillmentsMatchingAddress, gapReport, packingSort } from "../domain/delivery/derivations";
import { listFulfillments as listFulfillmentsFn, setFulfillmentsByOrderItems as setFulfillmentsByOrderItemsFn } from "../lib/cms/orders";
import { todayShanghai } from "../agent/services";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Injectable cms boundary (default = real fetch client). */
export type DeliveryDeps = {
  listFulfillments: (jwt: string, query: { date?: string; occasion?: string }) => Promise<Fulfillment[]>;
  setFulfillmentsByOrderItems: typeof setFulfillmentsByOrderItemsFn;
};

/**
 * `GET /delivery?date=&occasion=` — 送餐 tab 数据源：按楼栋分拣（源头防错）+ 缺口对账
 * （收尾防漏）。两个派生都在 be 算（§7.5 派生不落表）；cms 只给原始 fulfillments。
 *
 * `PATCH /fulfillments { address }` — 确定性「送达」勾销：把 order.address 含该片段的
 * 未完成履约批量标 done。取代靠 agent `mark_delivered` 的 tool-call（DeepSeek tool-calling
 * 实测不稳：误读地址 / 幻觉已送达却不发自 tool_call）。
 */
export function deliveryRoutes(
  jwtSecret: string,
  deps: DeliveryDeps = { listFulfillments: listFulfillmentsFn, setFulfillmentsByOrderItems: setFulfillmentsByOrderItemsFn },
) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));
  app.get("/", async (c) => {
    const fulfillments = await deps.listFulfillments(c.get("token") as string, {
      date: c.req.query("date") || undefined,
      occasion: c.req.query("occasion") || undefined,
    });
    return c.json({ sort: packingSort(fulfillments), gaps: gapReport(fulfillments) });
  });

  app.patch("/fulfillments", async (c) => {
    const jwt = c.get("token") as string;
    const body = (await c.req.json().catch(() => null)) as { address?: unknown } | null;
    if (typeof body?.address !== "string" || !body.address.trim()) {
      return c.json({ error: "address required" }, 400);
    }
    try {
      const fulfillments = await deps.listFulfillments(jwt, { date: todayShanghai(() => new Date()) });
      const targets = fulfillmentsMatchingAddress(fulfillments, body.address);
      if (targets.length === 0) return c.json({ ok: true, count: 0 });
      // Targets only hold address-matched fulfillments → orderItem is populated
      // (object with .order.address), never a bare id.
      const ids = targets.map((f) => (f.orderItem as { id: string | number }).id);
      await deps.setFulfillmentsByOrderItems(jwt, ids, { status: "done" });
      return c.json({ ok: true, count: targets.length });
    } catch {
      return c.json({ error: "mark failed" }, 502);
    }
  });

  return app;
}
