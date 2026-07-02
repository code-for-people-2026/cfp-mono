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
 * canceled（终态）不计入视图与计数。
 *
 * `PATCH /fulfillments` — 确定性「送达」勾销，两种 body：
 *  - `{ ids: [...] }`：精确标这几个 orderItem done（按钮用——避免 substring 跨地址误伤，Codex P1）。
 *  - `{ address }`：把 order.address 含该片段的未完成履约批量标 done（agent/语音用，按片段）。
 *  取代靠 agent `mark_delivered` 的 tool-call（DeepSeek tool-calling 实测不稳）。
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
    const active = fulfillments.filter((f) => f.status !== "canceled"); // Codex P2: terminal state, exclude from view + counts
    return c.json({ sort: packingSort(active), gaps: gapReport(active) });
  });

  app.patch("/fulfillments", async (c) => {
    const jwt = c.get("token") as string;
    const body = (await c.req.json().catch(() => null)) as { ids?: unknown; address?: unknown } | null;
    try {
      // Exact path (delivery buttons): mark exactly these orderItem ids done — no
      // substring spillover across addresses like "3A" matching "13A" (Codex P1).
      if (Array.isArray(body?.ids) && body.ids.length > 0) {
        const ids = body!.ids as Array<string | number>;
        await deps.setFulfillmentsByOrderItems(jwt, ids, { status: "done" });
        return c.json({ ok: true, count: ids.length });
      }
      // Substring path (voice / agent): mark open fulfillments whose address contains the fragment.
      if (typeof body?.address === "string" && body.address.trim()) {
        const fulfillments = await deps.listFulfillments(jwt, { date: todayShanghai(() => new Date()) });
        const targets = fulfillmentsMatchingAddress(fulfillments, body.address);
        if (targets.length === 0) return c.json({ ok: true, count: 0 });
        // Targets only hold address-matched fulfillments → orderItem is populated (object), never a bare id.
        const ids = targets.map((f) => (f.orderItem as { id: string | number }).id);
        await deps.setFulfillmentsByOrderItems(jwt, ids, { status: "done" });
        return c.json({ ok: true, count: targets.length });
      }
      return c.json({ error: "ids or address required" }, 400);
    } catch {
      return c.json({ error: "mark failed" }, 502);
    }
  });

  return app;
}
