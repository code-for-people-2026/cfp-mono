import { Hono } from "hono";
import type { Order, OrderStatus } from "@cfp/kith-inn-shared";
import { findOfferings } from "../lib/cms/client";
import {
  createFulfillments,
  createOrderDraft,
  getSeller,
  getOrder,
  listOrders as listOrdersFn,
  setFulfillmentsByOrderItems,
  updateOrder,
  upsertSlots,
} from "../lib/cms/orders";
import type { OrderUpdatePatch } from "../lib/cms/orders";
import type { OrderCms } from "../domain/orders/service";
import { OrderStateError, cancelOrder, confirmOrder, recordDraft } from "../domain/orders/service";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/**
 * Real cms surface = the imported client functions directly (their optional
 * `deps` param is happily dropped — they default to global fetch). No wrapper
 * lambdas, so there's nothing to cover beyond the functions themselves
 * (exercised in lib/cms/orders.test.ts via mocked fetch).
 */
function realCms(): OrderCms {
  return {
    getSeller,
    findOfferings,
    getOrder,
    createOrderDraft,
    updateOrder,
    upsertSlots,
    createFulfillments,
    setFulfillmentsByOrderItems,
  };
}

/** Injectable boundary (default = real cms). `listOrders` is read-only, kept separate. */
export type OrderRoutesDeps = {
  cms: OrderCms;
  listOrders: (jwt: string, query: { date?: string; status?: OrderStatus }) => Promise<Order[]>;
};

/**
 * Order routes (PRD §6.1 记单). All sellerAuth-protected; the operator JWT is
 * forwarded to cms as seller-token passthrough. Lifecycle: POST / (draft) →
 * POST /:id/confirm (materialize) / :id/cancel; PATCH /:id for payment/date/note
 * (status only changes via confirm/cancel, never a direct PATCH).
 */
export function orderRoutes(jwtSecret: string, deps: OrderRoutesDeps = { cms: realCms(), listOrders: listOrdersFn }) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));

  app.get("/", async (c) => {
    const orders = await deps.listOrders(c.get("token") as string, {
      date: c.req.query("date"),
      status: c.req.query("status") as OrderStatus | undefined,
    });
    return c.json({ orders });
  });

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { customer?: unknown; date?: unknown; source?: unknown; items?: unknown; note?: string; idempotencyKey?: string }
      | null;
    if (!body || typeof body.customer !== "number" || typeof body.date !== "string" || !Array.isArray(body.items)) {
      return c.json({ error: "customer, date, items required" }, 400);
    }
    try {
      const result = await recordDraft(c.get("token") as string, body as never, deps.cms);
      return c.json(result, 201);
    } catch {
      return c.json({ error: "record failed" }, 502);
    }
  });

  app.post("/:id/confirm", async (c) => {
    try {
      const result = await confirmOrder(c.get("token") as string, c.req.param("id"), deps.cms);
      return c.json(result);
    } catch (e) {
      if (e instanceof OrderStateError) {
        return c.json({ error: e.code }, 409);
      }
      return c.json({ error: "confirm failed" }, 502);
    }
  });

  app.post("/:id/cancel", async (c) => {
    try {
      await cancelOrder(c.get("token") as string, c.req.param("id"), deps.cms);
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "cancel failed" }, 502);
    }
  });

  /** Payment / date / note only — `status` is stripped (it only changes via the
   *  confirm/cancel lifecycle, never a direct FE PATCH). `delete` is allowed
   *  because `status` is optional on OrderUpdatePatch. */
  app.patch("/:id", async (c) => {
    const patch = { ...((await c.req.json().catch(() => ({}))) as OrderUpdatePatch) };
    delete patch.status;
    if (Object.keys(patch).length === 0) return c.json({ error: "no updatable fields" }, 400);
    try {
      const order = await deps.cms.updateOrder(c.get("token") as string, c.req.param("id"), patch);
      return c.json(order);
    } catch {
      return c.json({ error: "update failed" }, 502);
    }
  });

  return app;
}
